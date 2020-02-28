#![feature(proc_macro_hygiene, decl_macro, never_type)]
#[macro_use] extern crate rocket;
// #[macro_use] extern crate rocket_contrib;
use rocket::State;
use rocket_contrib::serve::StaticFiles;
use rocket_contrib::templates::Template;

use serde::Serialize;

use hackgt_nfc::api::CheckinAPI;
use hackgt_nfc::nfc::{ handle_cards, NFCBadge };

use brother_ql_rs::printer::{ printers, ThermalPrinter };
use brother_ql_rs::text::TextRasterizer;

use std::fs::{ self, File };
use std::io::Write;
use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::{ Arc, RwLock };

mod api;

type Threaded<T> = Arc<RwLock<T>>;
type ReaderAssignmentState = Threaded<HashMap<String, PrinterAssignment>>;
type PrintersState = Threaded<HashMap<String, Printer>>;

// Maps a unique reader name to a printer's serial number
#[derive(Debug)]
struct PrinterAssignment {
    reader_connected: bool,
    name: String,
    assigned_printer: Option<String>,
}

struct Printer {
    device: ThermalPrinter<rusb::GlobalContext>,
    rasterizer: TextRasterizer,
}

#[get("/")]
fn index(reader_assignments: State<ReaderAssignmentState>, printers: State<PrintersState>) -> Template {
    #[derive(Debug, Serialize)]
    struct Printer<'a> {
        manufacturer: &'a str,
        model: &'a str,
        serial_number: &'a str,
    }
    let printers = printers.read().unwrap();
    let printers: Vec<_> = printers
        .values()
        .map(|printer| {
            Printer {
                manufacturer: &printer.device.manufacturer,
                model: &printer.device.model,
                serial_number: &printer.device.serial_number,
            }
        })
        .collect();

    #[derive(Debug, Serialize)]
    struct Reader<'a> {
        name: &'a str,
        connected: bool,
        assigned_printer: Option<&'a str>,
    }
    let readers = reader_assignments.read().unwrap();
    let readers: Vec<_> = readers
        .values()
        .map(|reader| {
            Reader {
                name: &reader.name,
                connected: reader.reader_connected,
                assigned_printer: reader.assigned_printer.as_deref(),
            }
        })
        .collect();

    #[derive(Debug, Serialize)]
    struct IndexContext<'a> {
        printers: Vec<Printer<'a>>,
        readers: Vec<Reader<'a>>,
    }
    Template::render("index", IndexContext {
        printers,
        readers,
    })
}

struct ResourcesPaths {
    font: String,
    logo: String,
}
fn setup_data() -> Result<ResourcesPaths, std::io::Error> {
    let resources_directory = "./resources";

    let font = include_bytes!("../fonts/Raleway Bold.ttf");
    let font_path = format!("{}/font.ttf", resources_directory);
    let logo = include_bytes!("../logos/HackGT Mono.png");
    let logo_path = format!("{}/logo.png", resources_directory);

    let _ = fs::remove_dir_all(resources_directory);
    fs::create_dir(resources_directory)?;

    let mut buffer = File::create(&font_path)?;
    buffer.write_all(font)?;
    let mut buffer = File::create(&logo_path)?;
    buffer.write_all(logo)?;

    Ok(ResourcesPaths {
        font: font_path,
        logo: logo_path,
    })
}

fn main() {
    let username = env!("CHECKIN_USERNAME");
    let password = env!("CHECKIN_PASSWORD");
    let url = env!("CHECKIN_URL");
    let api = CheckinAPI::login(username, password, url).expect("Failed to login to check in");

    let resource_paths = setup_data().expect("Error extracting resources");

    // TODO: update continuously
    let printers: HashMap<String, _> = printers()
        .into_iter()
        .map(|device| {
            let device = ThermalPrinter::new(device).expect("Could not create printer");

            let mut rasterizer = TextRasterizer::new(
                device.current_label().unwrap(),
                PathBuf::from(&resource_paths.font)
            );
            rasterizer.set_second_row_image(PathBuf::from(&resource_paths.logo));

            (device.serial_number.clone(), Printer {
                device,
                rasterizer
            })
        })
        .collect();
    if printers.len() == 0 {
        panic!("No printers connected!");
    }
    else {
        println!("Found {} printer(s) and assigning readers in round-robin fashion", printers.len());
    }
    let printers: PrintersState = Arc::new(RwLock::new(printers));

    let reader_assignments: ReaderAssignmentState = Arc::new(RwLock::new(HashMap::new()));

    let mut threads = Vec::new();

    let reader_assignments_tap_handler = Arc::clone(&reader_assignments);
    let reader_assignments_reader_handler = Arc::clone(&reader_assignments);
    let printers_tap_handler = Arc::clone(&printers);
    let printers_reader_handler = Arc::clone(&printers);
    let handler_thread = handle_cards(move |card, reader, _reader_index| {
        let badge = NFCBadge::new(&card);
        badge.set_buzzer(false).unwrap();

        match badge.get_user_id() {
            Ok(id) => {
                match api.check_in(&id, "badge_label") {
                    Ok((_success, user, _tag)) => {
                        let reader_assignments = reader_assignments_tap_handler.read().unwrap();
                        let printers = printers_tap_handler.read().unwrap();

                        let reader_name = reader.to_string_lossy().to_string();
                        if let Some(serial_number) = reader_assignments
                            .get(&reader_name)
                            .map(|assignment| assignment.assigned_printer.as_ref())
                            .flatten()
                        {
                            if let Some(printer) = printers.get(serial_number) {
                                let lines = printer.rasterizer.rasterize(&user.name, None, 1.0, false);
                                if let Err(err) = printer.device.print(lines) {
                                    eprintln!("Error during printing: {:?}", err);
                                }
                            }
                            else {
                                eprintln!("No printer with serial number {}", &serial_number);
                            }
                        }
                        else {
                            eprintln!("No assignment for reader {}", &reader_name);
                        }
                    },
                    Err(hackgt_nfc::api::Error::Message("Invalid user ID on badge")) => {
                        eprintln!("User ID <{}> does not exist", &id);
                    },
                    Err(err) => {
                        eprintln!("API error: {:?}", err);
                    }
                };
            },
            Err(err) => {
                eprintln!("Error getting user ID: {:?}", err);
            }
        };

    }, move |reader, added| {
        let mut reader_assignments = reader_assignments_reader_handler.write().unwrap();
        let printers = printers_reader_handler.read().unwrap();

        let next_printer_index = reader_assignments.len() % printers.len();
        // .iter() iterates in arbitrary order but printers never changes (TODO) so it's fine
        let (next_printer_serial_number, _) = printers.iter().nth(next_printer_index).unwrap();

        let reader_name = reader.to_string_lossy().to_string();
        reader_assignments
            .entry(reader_name.clone())
            .and_modify(|assignment| assignment.reader_connected = added)
            .or_insert(PrinterAssignment {
                reader_connected: added,
                name: reader_name,
                assigned_printer: Some(next_printer_serial_number.to_string()),
            });
    });
    threads.push(handler_thread);

    // TODO: pack server dependencies into executable and reenable

    // let reader_assignments_server = Arc::clone(&reader_assignments);
    // let printers = Arc::clone(&printers);
    // let server_thread = std::thread::spawn(move || {
    //     rocket::ignite()
    //         .attach(Template::fairing())
    //         .mount("/", routes![index])
    //         // .mount("/api", routes![
    //         // 	api::initialize,
    //         // 	api::create_credentials,
    //         // 	api::get_tag,
    //         // 	api::authorize_device,
    //         // 	api::reject_device,
    //         // 	api::force_renew_device,
    //         // 	api::delete_device,
    //         // 	api::rename_device,
    //         // 	api::set_tag,
    //         // ])
    //         .mount("/css", StaticFiles::from("src/ui/css"))
    //         .mount("/js", StaticFiles::from("src/ui/js"))
    //         .manage(reader_assignments_server)
    //         .manage(printers)
    //         .launch();
    // });
    // threads.push(server_thread);

    for thread in threads {
        thread.join().unwrap();
    }
}

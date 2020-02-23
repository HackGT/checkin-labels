#![feature(proc_macro_hygiene, decl_macro, never_type)]
#[macro_use] extern crate rocket;
#[macro_use] extern crate rocket_contrib;
use rocket::State;
use rocket_contrib::serve::StaticFiles;
use rocket_contrib::templates::Template;

use serde::Serialize;

use hackgt_nfc::api::CheckinAPI;
use hackgt_nfc::nfc::{ handle_cards, NFCBadge };

use brother_ql_rs::printer::constants::label_data;
use brother_ql_rs::printer::{ printers, ThermalPrinter };
use brother_ql_rs::text::TextRasterizer;

use std::collections::HashMap;
use std::sync::{ Arc, RwLock };

type Threaded<T> = Arc<RwLock<T>>;
type ReaderAssignmentState = Threaded<HashMap<String, PrinterAssignment>>;
type PrintersState = Threaded<HashMap<String, ThermalPrinter<rusb::GlobalContext>>>;

// Maps a unique reader name to a printer's serial number
#[derive(Debug)]
struct PrinterAssignment {
    reader_connected: bool,
    name: String,
    assigned_printer: Option<String>,
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
                manufacturer: &printer.manufacturer,
                model: &printer.model,
                serial_number: &printer.serial_number,
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

fn main() {
    let printers: HashMap<String, _> = printers()
        .into_iter()
        .map(|device| {
            let printer = ThermalPrinter::new(device).expect("Could not create printer");
            (printer.serial_number.clone(), printer)
        })
        .collect();
    let printers: PrintersState = Arc::new(RwLock::new(printers));

    let reader_assignments: ReaderAssignmentState = Arc::new(RwLock::new(HashMap::new()));

    // let mut rasterizer = TextRasterizer::new(
    //     printers[0].current_label().unwrap(),
    //     PathBuf::from("./fonts/Space Mono Bold.ttf")
    // );
    // rasterizer.set_second_row_image(PathBuf::from("./logos/HackGT Mono.png"));

    // let lines = rasterizer.rasterize("Hello, world!", None, 1.2, false);
    // if let Err(err) = printers[0].print(lines) {
    //     eprintln!("Error during printing: {:?}", err);
    // }

    // let username = env!("CHECKIN_USERNAME");
    // let password = env!("CHECKIN_PASSWORD");

    // let api = CheckinAPI::login(username, password).expect("Failed to login to check in");

    let mut threads = Vec::new();

    let reader_assignments_reader_handler = Arc::clone(&reader_assignments);
    let handler_thread = handle_cards(move |card, reader, _reader_index| {
        dbg!(reader);
        // handler_manager.get(*printer_id.unwrap(), move |printer| {
        //     let badge = NFCBadge::new(&card);
        //     badge.set_buzzer(false).unwrap();

        //     match badge.get_user_id() {
        //         Ok(id) => {
        //             match api.check_in(&id, "badge_label") {
        //                 Ok((_success, user, _tag)) => {
        //                     let major = user.questions.into_iter().find(|q| q.name == "major").map(|q| q.value.unwrap());
        //                     let major = major.as_ref().map(String::as_str);

        //                     let lines = rasterizer.rasterize(&user.name, dbg!(major), 1.2);
        //                     if let Err(err) = printer.print(lines) {
        //                         eprintln!("Error during printing: {:?}", err);
        //                     }
        //                 },
        //                 Err(hackgt_nfc::api::Error::Message("Invalid user ID on badge")) => {
        //                     eprintln!("User ID <{}> does not exist", &id);
        //                 },
        //                 Err(err) => {
        //                     eprintln!("API error: {:?}", err);
        //                 }
        //             };
        //         },
        //         Err(err) => {
        //             eprintln!("Error getting user ID: {:?}", err);
        //         }
        //     };
        // });
    }, move |reader, added| {
        let mut reader_assignments = reader_assignments_reader_handler.write().unwrap();
        let reader_name = reader.to_string_lossy().to_string();
        reader_assignments
            .entry(reader_name.clone())
            .and_modify(|assignment| assignment.reader_connected = added)
            .or_insert(PrinterAssignment {
                reader_connected: added,
                name: reader_name,
                assigned_printer: None,
            });
    });
    threads.push(handler_thread);

    let reader_assignments_server = Arc::clone(&reader_assignments);
    let printers = Arc::clone(&printers);
    let server_thread = std::thread::spawn(move || {
        rocket::ignite()
            .attach(Template::fairing())
            .mount("/", routes![index])
            // .mount("/api", routes![
            // 	api::initialize,
            // 	api::create_credentials,
            // 	api::get_tag,
            // 	api::authorize_device,
            // 	api::reject_device,
            // 	api::force_renew_device,
            // 	api::delete_device,
            // 	api::rename_device,
            // 	api::set_tag,
            // ])
            .mount("/css", StaticFiles::from("src/ui/css"))
            .mount("/js", StaticFiles::from("src/ui/js"))
            .manage(reader_assignments_server)
            .manage(printers)
            .launch();
    });
    threads.push(server_thread);

    for thread in threads {
        thread.join().unwrap();
    }
}

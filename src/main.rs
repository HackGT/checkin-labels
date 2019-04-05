use hackgt_nfc::api::CheckinAPI;
use hackgt_nfc::nfc::{ handle_cards, NFCBadge };
use brother_ql_rs::printer::constants::label_data;
use brother_ql_rs::printer::{ PrinterManager };
use brother_ql_rs::text::TextRasterizer;
use std::path::PathBuf;
use std::collections::{ HashMap, VecDeque };
use std::ffi::CString;
use std::sync::{ Arc, RwLock };

fn main() {
    let mut printer_manager: Arc<PrinterManager> = Arc::new(PrinterManager::new().unwrap());

    let reader_printer_map: Arc<RwLock<HashMap<CString, u8>>> = Arc::new(RwLock::new(HashMap::new()));
    let printers: Arc<RwLock<VecDeque<u8>>> = Arc::new(RwLock::new(VecDeque::new()));

    let available_printers = printer_manager.available_devices().unwrap();
    assert!(available_printers > 0, "No printers found");
    // Assume that all printers are loaded with the same label media
    // And hardcode it
    let label = label_data(12, None).unwrap();

    let mut rasterizer = TextRasterizer::new(
        label,
        PathBuf::from("./fonts/Nobel Regular.ttf")
    );
    rasterizer.set_second_row_image(PathBuf::from("./logos/HackGT Mono.png"));

    let username = env!("CHECKIN_USERNAME");
    let password = env!("CHECKIN_PASSWORD");

    let api = CheckinAPI::login(username, password).expect("Failed to login to check in");

    // Set up card polling
    let handler1_reader_printer_map = Arc::clone(&reader_printer_map);
    let handler2_reader_printer_map = Arc::clone(&reader_printer_map);
    let handler_printers = Arc::clone(&printers);
    let handler_manager = Arc::get_mut(&mut printer_manager).unwrap();
    let handler_thread = handle_cards(move |card, reader, _reader_index| {
        let reader_printer_map = handler1_reader_printer_map.read().unwrap();
        let printer_id = reader_printer_map.get(reader);
        if printer_id.is_none() {
            println!("Reader {:?} is not associated with a printer", reader);
            return;
        }
        handler_manager.get(*printer_id.unwrap(), move |printer| {
            let badge = NFCBadge::new(&card);
            badge.set_buzzer(false).unwrap();

            match badge.get_user_id() {
                Ok(id) => {
                    match api.check_in(&id, "badge_label") {
                        Ok((_success, user, _tag)) => {
                            let major = user.questions.into_iter().find(|q| q.name == "major").map(|q| q.value.unwrap());
                            let major = major.as_ref().map(String::as_str);

                            let lines = rasterizer.rasterize(&user.name, dbg!(major), 1.2);
                            if let Err(err) = printer.print(lines) {
                                eprintln!("Error during printing: {:?}", err);
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
        });
    }, move |reader, added| {
        if !added {
            // Card reader removed
            match handler2_reader_printer_map.write().unwrap().remove(reader) {
                Some(printer) => {
                    // Queue printer as available again
                    handler_printers.write().unwrap().push_back(printer);
                    println!("{:?} disconnected", reader);
                },
                None => println!("{:?} removed but wasn't associated with a printer", reader)
            }
        }
        else {
            // Card reader added
            match handler_printers.write().unwrap().pop_front() {
                Some(printer) => {
                    // Associate this available printer with this reader
                    handler2_reader_printer_map.write().unwrap().insert(reader.to_owned(), printer);
                    println!("Associated {:?} with printer", reader);
                },
                None => println!("No available printers to associate with connected reader {:?}!", reader)
            }
        }
    });
    handler_thread.join().unwrap();
}

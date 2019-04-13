use hackgt_nfc::api::CheckinAPI;
use brother_ql_rs::printer::constants::label_data;
use brother_ql_rs::printer::{ PrinterManager };
use brother_ql_rs::text::TextRasterizer;
use std::path::PathBuf;
use std::thread;
use websocket::{ header, ClientBuilder, Message };
use websocket::message::OwnedMessage;
use serde_json::Value;
use crossbeam_channel::bounded;
use std::sync::Arc;

#[derive(Debug)]
struct BadgeData {
    name: String,
    is_minor: bool,
}

fn main() {
    let printer_manager: PrinterManager = PrinterManager::new().unwrap();

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

    let printer_manager = Arc::new(printer_manager);
    let rasterizer = Arc::new(rasterizer);

    const CHECKIN_URL: &'static str = "ws://localhost:3000/graphql";
    let username = env!("CHECKIN_USERNAME");
    let password = env!("CHECKIN_PASSWORD");

    let api = CheckinAPI::login(username, password).expect("Failed to login to check in");

    let (sender, receiver) = bounded::<BadgeData>(10);

    let sub_thread = thread::spawn(move || {
        let mut headers = header::Headers::new();
        let auth_cookie = format!("auth={}", api.auth_token());
        headers.set(header::Cookie(vec![ auth_cookie ]));
        headers.set_raw("Sec-WebSocket-Protocol", vec![ b"graphql-ws".to_vec() ]);

        let mut client = ClientBuilder::new(CHECKIN_URL)
            .unwrap()
            .custom_headers(&headers)
            .connect(None)
            .expect("Could not connect to WebSocket server");
        // Set up the GraphQL subscription
        client.send_message(&Message::text(r#"{"type":"connection_init","payload":{}}"#)).unwrap();
        client.send_message(&Message::text(r#"{ "id": "1", "type": "start", "payload": { "variables": {}, "extensions": {}, "operationName": null, "query": "subscription { tag_change { user { id\nname} tags { last_successful_checkin { checked_in\nchecked_in_by\nchecked_in_date } } } }" } }"#)).unwrap();
        if let OwnedMessage::Text(response) = client.recv_message().unwrap() {
            assert_eq!(response, "{\"type\":\"connection_ack\"}");
        }
        else {
            panic!("Non-text message received while setting up WebSocket connection");
        }
        for message in client.incoming_messages() {
            if let OwnedMessage::Text(event_data) = message.unwrap() {
                let event_data: Value = serde_json::from_str(&event_data).expect("Invalid JSON");

                let checked_in: bool = event_data
                    .pointer("/payload/data/tag_change/tags/0/last_successful_checkin/checked_in")
                    .expect("No last successful checkin value")
                    .as_bool().unwrap();
                // Don't print labels for check out events
                if !checked_in { continue; }

                let user = event_data.pointer("/payload/data/tag_change/user").expect("No user info");
                let uuid = user["id"].as_str().unwrap();
                let name = user["name"].as_str().unwrap();

                let pickup_persons = api.get_pickup_persons(uuid).unwrap();
                sender.send(BadgeData {
                    name: name.to_string(),
                    is_minor: pickup_persons.len() > 0
                }).unwrap();
            }
        }
    });

    for id in 0..available_printers {
		let receiver = receiver.clone();
        let printer_manager = printer_manager.clone();
        let rasterizer = rasterizer.clone();
        thread::spawn(move || {
            printer_manager.get(id, move |printer| {
                println!("Printer thread {} spawned", id);
                for badge_data in receiver.iter() {
                    let lines = rasterizer.rasterize(&badge_data.name, None, 1.0);
                    if let Err(err) = printer.print(lines) {
                        eprintln!("Error during printing: {:?}", err);
                    }
                }
            });
        });
    }

    sub_thread.join().unwrap();
}

use brother_ql_rs::printer::constants::label_data;
use brother_ql_rs::printer::{ PrinterManager };
use brother_ql_rs::text::TextRasterizer;
use std::path::PathBuf;
use std::io::{ stdin, stdout, Write};

fn main() {
    let mut printer_manager: PrinterManager = PrinterManager::new().unwrap();

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

    printer_manager.get(0, move |printer| {
        loop {
            let mut name = String::new();
            print!("Name (\"q\" to exit) > ");
            let _ = stdout().flush();
            stdin().read_line(&mut name).expect("Did not enter a correct string");
            if let Some('\n') = name.chars().next_back() {
                name.pop();
            }
            if let Some('\r') = name.chars().next_back() {
                name.pop();
            }
            let minor = if name.chars().next().unwrap() == '!' {
                name.remove(0);
                true
            }
            else {
                false
            };

            if name.chars().next().unwrap_or('q') == 'q' {
                break;
            }

            let lines = rasterizer.rasterize(&name, None, 1.0, minor);
            if let Err(err) = printer.print(lines) {
                eprintln!("Error during printing: {:?}", err);
            }
        }
    });
}

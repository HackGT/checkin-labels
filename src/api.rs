// use rocket_contrib::json::{ Json, JsonValue };

// #[derive(Deserialize)]
// pub struct DeviceRenameAction {
//     username: String,
//     name: String,
// }
// #[post("/device/rename", format = "json", data = "<request>")]
// pub fn rename_device(request: Json<DeviceRenameAction>, db: State<DB>) -> Result<JsonValue, mongodb::error::Error> {
//     let response = match Device::find_one(db.clone(), Some(doc! { "username": &request.username }), None)? {
//         Some(device) => {
//             device.update(
//                 db.clone(),
//                 None,
//                 doc! { "$set": {
//                     "friendly_name": request.name.clone(),
//                 } },
//                 None
//             )?;
//             json!({
//                 "success": true,
//             })
//         },
//         None => {
//             json!({
//                 "success": false,
//                 "error": "Device not found",
//             })
//         }
//     };
//     Ok(response)
// }

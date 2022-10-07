import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { usb } from "usb";
import fetch from "node-fetch";
const { NFC } = require("nfc-pcsc");

import * as BrotherQL from "./brother";
import { NDEFParser } from "./NDEFParser";

dotenv.config();

// Throw and show a stack trace on an unhandled Promise rejection instead of logging an unhelpful warning
process.on("unhandledRejection", (err) => {
  throw err;
});

const Config: { url: string; key: string } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./config.json"), "utf8")
);

let printers = new Map<number, BrotherQL.Printer>();
let printersInUse = new Set<number>();

async function addPrinter(device: usb.Device) {
  const printer = new BrotherQL.Printer(device.deviceAddress);
  await printer.init();
  printer.attachErrorHandler((err) => {
    // Silently handle instead of crashing
    console.log(err);
  });
  printer.useFont("Chicago", path.join(__dirname, "/../fonts/Chicago.ttf"));

  printers.set(device.deviceAddress, printer);

  let info = await printer.getStatus();
  console.log(
    `Found ${info.model} loaded with ${JSON.stringify(
      info.media
    )} at USB address ${device.deviceAddress} (${printers.size} total)`
  );
}

function removePrinter(device: usb.Device) {
  printers.delete(device.deviceAddress);
  printersInUse.delete(device.deviceAddress);
  console.log(
    `Removed printer at USB address ${device.deviceAddress} (${printers.size} total)`
  );
}

BrotherQL.Printer.getAvailablePrinters().forEach(addPrinter);

usb.on("attach", async (device) => {
  if (BrotherQL.Printer.isPrinter(device)) {
    await addPrinter(device);
  }
});
usb.on("detach", (device) => {
  if (BrotherQL.Printer.isPrinter(device)) {
    removePrinter(device);
  }
});

const nfc = new NFC();

async function query<T>(
  query: string,
  variables?: { [name: string]: string }
): Promise<T> {
  let response = await fetch(Config.url + "/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(Config.key, "utf8").toString(
        "base64"
      )}`,
    },
    body: JSON.stringify({
      query,
      variables: variables || {},
    }),
  });

  const json: any = await response.json();
  if (response.ok) {
    return json.data;
  } else {
    throw new Error(JSON.stringify(json.errors));
  }
}

nfc.on("reader", async (reader: any) => {
  if (!(reader.reader.name as string).match(/ACR122/i)) {
    reader.autoProcessing = false;
    console.log(`Skipping invalid reader: ${reader.reader.name}`);
    return;
  }
  reader.aid = "F222222222";

  let printerID: number | null = null;
  function getPrinter() {
    printerID = null;
    for (let [id] of printers.entries()) {
      if (!printersInUse.has(id)) {
        printersInUse.add(id);
        printerID = id;
        console.log(
          `${reader.reader.name} assigned to printer at USB address ${id}`
        );
        break;
      }
    }
  }

  reader.on("card", async () => {
    let printer = printers.get(printerID || Number.MIN_SAFE_INTEGER);
    if (!printer) {
      getPrinter();
    }
    if (!printerID) {
      console.warn(
        `${reader.reader.name} not assigned to a printer (not enough)`
      );
      return;
    } else {
      printer = printers.get(printerID)!;
    }

    let data: Buffer;
    let url: string;
    try {
      data = await reader.read(4, 70);
      url = new NDEFParser(data).getURI();
    } catch (err) {
      console.error(err);
      return;
    }
    console.log(data);
    console.log(url);
    const match = url.match(/^https:\/\/live.hack.gt\/?\?user=([a-f0-9\-]+)$/i);
    if (!match) {
      console.warn(`Invalid URL: ${url}`);
      return;
    }
    const [, id] = match;

    interface UserResponse {
      user: {
        name: string;
        application: {
          type: string;
          data: {
            name: string;
            value: string;
          }[];
        } | null;
      } | null;
    }
    const { user } = await query<UserResponse>(`
		{ user(id: "${id}") {
			name,
			application {
				type,
				data {
					name,
					value
				}
			}
		} }`);
    if (!user) {
      console.warn(`ID ${id} not found in registration`);
      return;
    }
    if (!user.application) {
      console.warn(`User ${id} (${user.name}) has not applied`);
      return;
    }
    let name = user.name;
    let secondary: string | undefined = undefined;

    if (
      [
        "Participant - Travel Reimbursement",
        "Participant - Travel Reimbursement",
      ].includes(user.application.type)
    ) {
      secondary = user.application.data.find(
        (item) => item.name === "school"
      )!.value;
    }
    if (user.application.type === "Mentor") {
      secondary = user.application.data.find(
        (item) => item.name === "major"
      )!.value;
    }
    if (user.application.type === "Volunteer") {
      secondary =
        user.application.data.find((item) => item.name === "volunteer-role")!
          .value + " Volunteer";
    }
    if (user.application.type === "Sponsor") {
      secondary = user.application.data.find(
        (item) => item.name === "company"
      )!.value;
    }

    await printer.print(
      await printer.rasterizeText(name, secondary, __dirname + "/HackGT.png")
    );
  });

  reader.on("error", (err: Error) => {
    console.error(err);
  });
  reader.on("end", function () {
    if (printerID) {
      printersInUse.delete(printerID);
    }
    console.log(
      `${reader.reader.name} removed and unassigned from printer at USB address ${printerID}`
    );
  });
});

nfc.on("error", (err: Error) => {
  console.error(err);
});

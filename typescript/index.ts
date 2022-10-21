import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { usb } from "usb";
import fetch from "node-fetch";
const { NFC } = require("nfc-pcsc");
const NodeCache = require("node-cache");
import admin from "firebase-admin";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";

import { BrotherQLPrinter } from "./BrotherQLPrinter";
import { NDEFParser } from "./NDEFParser";
import axios from "axios";

dotenv.config();

// Initialize firebase admin with credentials
admin.initializeApp();
const app = initializeApp({
  apiKey: "AIzaSyCsukUZtMkI5FD_etGfefO4Sr7fHkZM7Rg",
  authDomain: "auth.hexlabs.org",
});
const auth = getAuth(app);

// Throw and show a stack trace on an unhandled Promise rejection instead of logging an unhelpful warning
process.on("unhandledRejection", (err) => {
  throw err;
});

const cache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

const HEXATHON_ID = process.env.HEXATHON_ID ?? "";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "";

if (!HEXATHON_ID || !ADMIN_USER_ID) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const getIdToken = async (userId: string) => {
  // Cache id token for 30 minutes so we don't have to keep fetching it
  let idToken = cache.get("idToken");
  if (idToken) {
    return idToken;
  }
  const customToken = await admin.auth().createCustomToken(userId);
  const userCredential = await signInWithCustomToken(auth, customToken);
  idToken = await userCredential.user.getIdToken();

  cache.set("idToken", idToken, 60 * 30);

  return idToken;
};

const Config: { url: string; key: string } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./config.json"), "utf8")
);

let printers = new Map<number, BrotherQLPrinter>();
let printersInUse = new Set<number>();

async function addPrinter(device: usb.Device) {
  const printer = new BrotherQLPrinter(device.deviceAddress);
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

BrotherQLPrinter.getAvailablePrinters().forEach(addPrinter);

usb.on("attach", async (device) => {
  if (BrotherQLPrinter.isPrinter(device)) {
    await addPrinter(device);
  }
});
usb.on("detach", (device) => {
  if (BrotherQLPrinter.isPrinter(device)) {
    removePrinter(device);
  }
});

const nfc = new NFC();

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

    let uid: string;
    try {
      const data: Buffer = await reader.read(4, 70);
      const ndef = new NDEFParser(data);
      const json = await JSON.parse(ndef.getText());
      uid = json.uid;
    } catch (err) {
      console.error(err);
      return;
    }

    let application;
    try {
      const response = await axios.get(
        `https://registration.api.hexlabs.org/applications?userId=${uid}&hexathon=${HEXATHON_ID}`,
        {
          headers: {
            Authorization: `Bearer ${await getIdToken(ADMIN_USER_ID)}`,
          },
        }
      );

      const data = response.data;

      if (!data?.applications || data.applications.length === 0) {
        throw new Error("Invalid application");
      }
      application = data.applications[0];
    } catch (err) {
      console.warn(err);
      return;
    }

    let name = application.name;
    let secondary: string | undefined = undefined;

    if (application.applicationData?.school) {
      secondary = application.applicationData.school;
    } else if (application.applicationData?.company) {
      secondary = application.applicationData.company;
    }

    try {
      await printer.print(
        await printer.rasterizeText(
          name,
          secondary,
          path.join(__dirname, "/../logos/HackGT Classic (Transparent).png")
        )
      );
    } catch (e) {
      console.warn(e);
    }
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

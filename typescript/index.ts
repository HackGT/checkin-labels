import * as fs from "fs";
import * as urllib from "url";
import * as path from "path";
import * as usb from "usb";
import * as BrotherQL from "brother-ql";
const { NFC } = require("nfc-pcsc");
import fetch from "node-fetch";

const Config: { url: string; key: string } = JSON.parse(fs.readFileSync(path.join(__dirname, "./config.json"), "utf8"));

const VendorID = 0x04F9;
const USBProductIDs: number[] = [
	0x2015, // QL-500
	0x2016, // QL-550
	0x2027, // QL-560
	0x2028, // QL-570
	0x2029, // QL-580N
	0x201B, // QL-650TD
	0x2042, // QL-700
	0x2020, // QL-1050
	0x202A, // QL-1060N
];

let printers = new Map<number, BrotherQL.Printer>();
let printersInUse = new Set<number>();
function isPrinter(device: usb.Device): boolean {
	return device.deviceDescriptor.idVendor === VendorID && USBProductIDs.includes(device.deviceDescriptor.idProduct);
}
async function addPrinter(device: usb.Device) {
	const printer = new BrotherQL.Printer(device.deviceAddress);
	await printer.init();
	printer.attachErrorHandler(err => {
		// Silently handle instead of crashing
		console.log(err);
	});
	printer.useFont("Chicago", __dirname + "/Chicago.ttf");

	printers.set(device.deviceAddress, printer);

	let info = await printer.getStatus();
	console.log(`Found ${info.model} loaded with ${JSON.stringify(info.media)} at USB address ${device.deviceAddress} (${printers.size} total)`);
}
function removePrinter(device: usb.Device) {
	printers.delete(device.deviceAddress);
	printersInUse.delete(device.deviceAddress);
	console.log(`Removed printer at USB address ${device.deviceAddress} (${printers.size} total)`);
}

BrotherQL.Printer.getAvailable().forEach(addPrinter);
usb.on("attach", async device => {
	if (isPrinter(device)) {
		await addPrinter(device);
	}
});
usb.on("detach", device => {
	if (isPrinter(device)) {
		removePrinter(device);
	}
});

const nfc = new NFC();

enum ParserState {
	None,
	NDEFInitial,
	NDEFTypeLength,
	NDEFPayloadLength,
	NDEFRecordType,
	NDEFData
}
enum WellKnownType {
	Unknown,
	Text,
	URI
}
class NDEFParser {
	private state = ParserState.None;
	private ndefType = WellKnownType.Unknown;
	private recordTypeLength = 1;
	private initialDataByte = NaN;
	private content: Buffer = Buffer.alloc(0);
	private contentIndex = 0;

	constructor(public readonly buffer: Buffer) {
		for (let i = 0; i < buffer.length; i++) {
			const byte = buffer[i];

			if (this.state === ParserState.None) {
				if (byte === 0x00) {
					// NULL block, skip
					i++;
					continue;
				}
				if (byte === 0x03 && buffer.length > i + 2 && buffer[i + 2] === 0xD1) {
					// NDEF message
					// Skip length field for now
					i++;
					this.state = ParserState.NDEFInitial;
					continue;
				}
			}
			else if (this.state === ParserState.NDEFInitial) {
				if ((byte & 1 << 0) !== 1) {
					throw new Error("Only NFC Well Known Records are supported");
				}
				if ((byte & 1 << 4) === 0) {
					throw new Error("Only short records supported currently");
				}
				if ((byte & 1 << 6) === 0) {
					throw new Error("Message must be end message currently");
				}
				if ((byte & 1 << 7) === 0) {
					throw new Error("Message must be beginning message currently");
				}
				this.state = ParserState.NDEFTypeLength;
			}
			else if (this.state === ParserState.NDEFTypeLength) {
				this.recordTypeLength = byte;
				this.state = ParserState.NDEFPayloadLength;
			}
			else if (this.state === ParserState.NDEFPayloadLength) {
				this.content = Buffer.alloc(byte);
				this.contentIndex = 0;
				this.state = ParserState.NDEFRecordType;
			}
			else if (this.state === ParserState.NDEFRecordType) {
				if (byte === 0x54) {
					this.ndefType = WellKnownType.Text;
				}
				if (byte === 0x55) {
					this.ndefType = WellKnownType.URI;
				}
				this.initialDataByte = NaN;
				this.state = ParserState.NDEFData;
			}
			else if (this.state === ParserState.NDEFData) {
				if (byte === 0xFE) {
					this.state = ParserState.None;
					continue;
				}
				this.content[this.contentIndex] = byte;
				this.contentIndex++;
			}
		}
	}

	public getURI(): string {
		if (this.content.length < 2 || this.ndefType !== WellKnownType.URI) {
			throw new Error("No URI found in parsed content");
		}
		return this.getProtocol(this.content[0]) + this.content.slice(1, this.content.length).toString("utf8");
	}
	public getText(): string {
		if (this.content.length < 4 || this.ndefType !== WellKnownType.Text) {
			throw new Error("No text content found on tag");
		}
		const languageCodeLength = this.content[0];
		return this.content.slice(1 + languageCodeLength, this.content.length).toString("utf8");
	}
	public getContent(): string {
		if (this.ndefType === WellKnownType.Text) {
			return this.getText();
		}
		else if (this.ndefType === WellKnownType.URI) {
			return this.getURI();
		}
		else {
			return "";
		}
	}

	private getProtocol(identifier: number): string {
		switch (identifier) {
			case 0x00: return ""
			case 0x01: return "http://www."
			case 0x02: return "https://www."
			case 0x03: return "http://"
			case 0x04: return "https://"
			case 0x05: return "tel:"
			case 0x06: return "mailto:"
			case 0x07: return "ftp://anonymous:anonymous@"
			case 0x08: return "ftp://ftp."
			case 0x09: return "ftps://"
			case 0x0A: return "sftp://"
			case 0x0B: return "smb://"
			case 0x0C: return "nfs://"
			case 0x0D: return "ftp://"
			case 0x0E: return "dav://"
			case 0x0F: return "news:"
			case 0x10: return "telnet://"
			case 0x11: return "imap:"
			case 0x12: return "rtsp://"
			case 0x13: return "urn:"
			case 0x14: return "pop:"
			case 0x15: return "sip:"
			case 0x16: return "sips:"
			case 0x17: return "tftp:"
			case 0x18: return "btspp://"
			case 0x19: return "btl2cap://"
			case 0x1A: return "btgoep://"
			case 0x1B: return "tcpobex://"
			case 0x1C: return "irdaobex://"
			case 0x1D: return "file://"
			case 0x1E: return "urn: epc: id:"
			case 0x1F: return "urn: epc: tag:"
			case 0x20: return "urn: epc: pat:"
			case 0x21: return "urn: epc: raw:"
			case 0x22: return "urn: epc:"
			case 0x23: return "urn: nfc:"
		}
		return "";
	}
}

async function query<T>(query: string, variables?: { [name: string]: string }): Promise<T> {
	let response = await fetch(urllib.resolve(Config.url, "/graphql"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Basic ${Buffer.from(Config.key, "utf8").toString("base64")}`
		},
		body: JSON.stringify({
			query,
			variables: variables || {}
		})
	});
	let json = await response.json();
	if (response.ok) {
		return json.data;
	}
	else {
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
		for (let [id, ] of printers.entries()) {
			if (!printersInUse.has(id)) {
				printersInUse.add(id);
				printerID = id;
				console.log(`${reader.reader.name} assigned to printer at USB address ${id}`);
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
			console.warn(`${reader.reader.name} not assigned to a printer (not enough)`);
			return;
		}
		else {
			printer = printers.get(printerID)!;
		}

		let data: Buffer;
		let url: string;
		try {
			data = await reader.read(4, 70);
			url = new NDEFParser(data).getURI();
		}
		catch {
			return;
		}
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

		if (["Participant - Travel Reimbursement", "Participant - Travel Reimbursement"].includes(user.application.type)) {
			secondary = user.application.data.find(item => item.name === "school")!.value;
		}
		if (user.application.type === "Mentor") {
			secondary = user.application.data.find(item => item.name === "major")!.value;
		}
		if (user.application.type === "Volunteer") {
			secondary = user.application.data.find(item => item.name === "volunteer-role")!.value + " Volunteer";
		}
		if (user.application.type === "Sponsor") {
			secondary = user.application.data.find(item => item.name === "company")!.value;
		}

		await printer.print(await printer.rasterizeText(name, secondary, __dirname + "/HackGT.png"));
	});

	reader.on("error", (err: Error) => {
		console.error(err);
	});
	reader.on('end', function () {
		if (printerID) {
			printersInUse.delete(printerID);
		}
		console.log(`${reader.reader.name} removed and unassigned from printer at USB address ${printerID}`);
	});
});

nfc.on("error", (err: Error) => {
	console.error(err);
});

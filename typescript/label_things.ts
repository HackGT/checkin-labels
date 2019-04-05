import * as BrotherQL from "brother-ql";
const printer = new BrotherQL.Printer();

(async () => {
	await printer.init();
	printer.useFont("Chicago", __dirname + "/Chicago.ttf");

	for (let i = 22; i <= 22; i++) {
		let text = await printer.rasterizeText(`HackGT Reader #${i}`, undefined, undefined, 570);
		await printer.print(text);
	}
})()

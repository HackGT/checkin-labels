import * as path from "path";
import * as BrotherQL from "./brother";

const printer = new BrotherQL.Printer();

(async () => {
  await printer.init();
  printer.useFont("Chicago", path.join(__dirname, "/../fonts/Chicago.ttf"));

  for (let i = 22; i <= 22; i++) {
    let text = await printer.rasterizeText(
      `HackGT Reader #${i}`,
      undefined,
      undefined,
      570
    );
    await printer.print(text);
  }
})();

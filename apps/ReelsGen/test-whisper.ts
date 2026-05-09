import Replicate from "replicate";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function main() {
  const whisperRes = await replicate.run(
    "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
    {
      input: {
        audio_file: "https://rendi.dev/sample/sample.avi", // Just any small audio file, wait, we need a valid audio file
        language: "en",
        align_output: true
      },
    }
  );
  console.log(JSON.stringify(whisperRes, null, 2));
}

main().catch(console.error);

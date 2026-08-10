#!/usr/bin/env node
/*
 * Cut four 5x4 ImageGen contact sheets into avatars 21-100.
 *
 * Usage:
 *   node tools/import_social_avatar_sheets.js <sharp-module-path>
 *
 * The source sheets are kept under art_sources so the imported resources can
 * be rebuilt. Existing avatars 01-20 and their Cocos UUIDs are never touched.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sharpModulePath = process.argv[2] || "sharp";
const sharp = require(sharpModulePath);

const sourceDir = path.join(root, "art_sources", "avatars", "social_avatars");
const outputDir = path.join(root, "assets", "resources", "avatars");
const previewPath = path.join(sourceDir, "social_avatar_library_preview.png");
const sheets = [1, 2, 3, 4].map((number) =>
  path.join(sourceDir, `source_batch_${String(number).padStart(2, "0")}.png`)
);

const avatarSize = 256;
const columns = 5;
const rows = 4;

function uuidV5(name) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const hash = crypto.createHash("sha1").update(namespace).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function avatarFileName(index) {
  return `头像${String(index).padStart(2, "0")}`;
}

function writeMeta(imagePath, index) {
  const name = avatarFileName(index);
  const textureUuid = uuidV5(`qing-social-avatar/texture/${name}`);
  const frameUuid = uuidV5(`qing-social-avatar/sprite-frame/${name}`);
  const meta = {
    ver: "2.3.7",
    uuid: textureUuid,
    importer: "texture",
    type: "sprite",
    wrapMode: "clamp",
    filterMode: "bilinear",
    premultiplyAlpha: false,
    genMipmaps: false,
    packable: true,
    width: avatarSize,
    height: avatarSize,
    platformSettings: {},
    subMetas: {
      [name]: {
        ver: "1.0.6",
        uuid: frameUuid,
        importer: "sprite-frame",
        rawTextureUuid: textureUuid,
        trimType: "none",
        trimThreshold: 1,
        rotated: false,
        offsetX: 0,
        offsetY: 0,
        trimX: 0,
        trimY: 0,
        width: avatarSize,
        height: avatarSize,
        rawWidth: avatarSize,
        rawHeight: avatarSize,
        borderTop: 0,
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        subMetas: {},
      },
    },
  };
  fs.writeFileSync(`${imagePath}.meta`, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function circleMask() {
  return Buffer.from(
    `<svg width="${avatarSize}" height="${avatarSize}"><circle cx="128" cy="128" r="126" fill="white"/></svg>`
  );
}

async function importSheets() {
  fs.mkdirSync(outputDir, { recursive: true });
  const imported = [];

  for (let batch = 0; batch < sheets.length; batch += 1) {
    const sheetPath = sheets[batch];
    const metadata = await sharp(sheetPath).metadata();
    const cellWidth = metadata.width / columns;
    const cellHeight = metadata.height / rows;
    const side = Math.floor(Math.min(cellWidth, cellHeight)) - 4;

    for (let slot = 0; slot < columns * rows; slot += 1) {
      const column = slot % columns;
      const row = Math.floor(slot / columns);
      const left = Math.round(column * cellWidth + (cellWidth - side) / 2);
      const top = Math.round(row * cellHeight + (cellHeight - side) / 2);
      const index = 21 + batch * columns * rows + slot;
      const imagePath = path.join(outputDir, `${avatarFileName(index)}.png`);

      await sharp(sheetPath)
        .extract({ left, top, width: side, height: side })
        .resize(avatarSize, avatarSize, { fit: "cover" })
        .ensureAlpha()
        .composite([{ input: circleMask(), blend: "dest-in" }])
        .png({ compressionLevel: 9 })
        .toFile(imagePath);
      writeMeta(imagePath, index);
      imported.push(imagePath);
    }
  }

  return imported;
}

async function buildPreview() {
  const tileSize = 92;
  const gap = 7;
  const margin = 12;
  const columnsInPreview = 10;
  const previewSize = margin * 2 + columnsInPreview * tileSize + (columnsInPreview - 1) * gap;
  const composites = [];

  for (let index = 1; index <= 100; index += 1) {
    const source = path.join(outputDir, `${avatarFileName(index)}.png`);
    const input = await sharp(source).resize(tileSize, tileSize).png().toBuffer();
    const slot = index - 1;
    composites.push({
      input,
      left: margin + (slot % columnsInPreview) * (tileSize + gap),
      top: margin + Math.floor(slot / columnsInPreview) * (tileSize + gap),
    });
  }

  await sharp({
    create: {
      width: previewSize,
      height: previewSize,
      channels: 4,
      background: { r: 4, g: 22, b: 31, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(previewPath);
}

async function main() {
  for (const sheet of sheets) {
    if (!fs.existsSync(sheet)) throw new Error(`missing source sheet: ${sheet}`);
  }
  const imported = await importSheets();
  await buildPreview();
  console.log(`imported ${imported.length} new avatars; total library: 100`);
  console.log(`preview: ${previewPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

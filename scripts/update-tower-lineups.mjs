import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CONFIG_BUNDLE_BASE,
  getAssetInfo,
  unpackAsset,
} from "../src/utils/cocosConfigBundle.js";
import { HERO_DICT } from "../src/utils/HeroList.js";
import { TOWER_MANIFEST_URL } from "../src/utils/towerEnemyLineups.js";

// Download only public game configuration. An offline directory is useful for
// reproducing a specific release without relying on a network connection.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--offline-dir")) {
  throw new Error(
    "Usage: node scripts/update-tower-lineups.mjs [--offline-dir DIR]",
  );
}
const offlineDir = args[1];
const base = CONFIG_BUNDLE_BASE;

async function getJson(url, name, options = {}) {
  if (offlineDir)
    return JSON.parse(await readFile(join(offlineDir, `${name}.json`), "utf8"));
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

function asObject(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

const manifest = await getJson(TOWER_MANIFEST_URL, "manifest", {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=UTF-8" },
  body: "",
});
const versions = asObject(asObject(manifest.body)?.bundleVers);
const configVersion = versions?.config;
if (typeof configVersion !== "string" || !/^[a-z\d]+$/i.test(configVersion))
  throw new Error("Missing config bundle version");
const bundle = await getJson(`${base}config.${configVersion}.json`, "bundle");
const assetNames = ["tower", "levelcoef", "level", "language"];
const assetInfo = Object.fromEntries(
  assetNames.map((name) => [name, getAssetInfo(bundle, name)]),
);
const payloads = await Promise.all(
  assetNames.map(async (name) =>
    unpackAsset(await getJson(assetInfo[name].url, name), name),
  ),
);
const [tower, levelcoef, level, language] = payloads;
const tables = tower.TowerConf;
const monsters = levelcoef.MonsterConf;
const avatars = level.AvatarConf;
const translations = Object.assign(
  {},
  ...Object.values(language.LanguageConf || {}),
);
if (!tables || !monsters || !avatars)
  throw new Error("Missing required game configuration");

const ids = Object.keys(tables)
  .map(Number)
  .sort((a, b) => a - b);
if (!ids.length || ids.some((id, index) => id !== index + 1))
  throw new Error("Tower stage IDs are not consecutive from 1");
const lineups = ids.map((id) => {
  const enemies = tables[id]?.monsters;
  if (!Array.isArray(enemies) || enemies.length !== 5)
    throw new Error(`Stage ${id} does not contain five enemies`);
  return [...enemies]
    .sort((a, b) => a[1] - b[1])
    .map(([monsterId, position], index) => {
      const monster = monsters[monsterId];
      const avatar = avatars[monster?.skinId];
      const match = /^hero_(\d+)$/.exec(monster?.monsterName || "");
      const heroId = Number(match?.[1]);
      const officialName = translations[avatar?.nickName]?.chinese;
      if (
        position !== index + 10 ||
        !heroId ||
        HERO_DICT[heroId]?.name !== officialName
      )
        throw new Error(
          `Stage ${id}: cannot verify enemy ${monsterId} at position ${position}`,
        );
      return heroId;
    });
});

const lines = lineups.map((row) => `    [${row.join(", ")}]`).join(",\n");
const output = `{
  "configVersion": ${JSON.stringify(configVersion)},
  "towerVersion": ${JSON.stringify(assetInfo.tower.version)},
  "lineups": [\n${lines}\n  ]
}\n`;
await writeFile(join(root, "src/data/towerLineups.json"), output);
console.log(
  `Updated ${lineups.length} tower stages from config ${configVersion}`,
);

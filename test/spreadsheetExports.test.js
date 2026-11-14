import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { loadModule } from "./helpers/loadModule.js";

// The optional override lets us exercise the official tarball before the
// project switches its dependency; ordinary CI always tests the installed xlsx.
const source = process.env.XYZW_TEST_XLSX_MODULE;
const XLSX = await import(source ? pathToFileURL(source).href : "xlsx");

async function exportedWorkbook(moduleName, functionName, records) {
  const files = [];
  const dependencies = {
    xlsx: {
      ...XLSX,
      writeFile(workbook, name) {
        files.push({ workbook, name });
      },
    },
    "./legionWarTime.js": {},
  };
  const mod = await loadModule(
    new URL(`../src/utils/${moduleName}.js`, import.meta.url),
    dependencies,
  );
  await mod[functionName](records, "2026/11/14");
  assert.equal(files.length, 1);
  const binary = XLSX.write(files[0].workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  return {
    name: files[0].name,
    workbook: XLSX.read(binary, { type: "buffer" }),
  };
}

test("盐场匹配导出生成可读取的中文表格和总计", async () => {
  const { name, workbook } = await exportedWorkbook(
    "clubWarrankUtils",
    "formatWarrankRecordsForExport",
    [
      {
        id: 12,
        serverId: 888,
        name: "测试俱乐部",
        power: 10000,
        redQuench: 5,
        sRScore: 123,
        announcement: "",
      },
    ],
  );
  assert.equal(name, "盐场匹配详情_2026-11-14.xlsx");
  assert.deepEqual(workbook.SheetNames, ["盐场匹配详情"]);
  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1 },
  );
  assert.equal(rows[0][3], "俱乐部名");
  assert.equal(rows[1][3], "测试俱乐部");
  assert.equal(rows[1][5], 5);
  assert.equal(rows[2][0], "总计");
});

test("黄金积分导出保留明细和联盟汇总", async () => {
  const { name, workbook } = await exportedWorkbook(
    "goldWarrankUtils",
    "formatWarrankRecordsForExport",
    [
      {
        id: 4,
        serverId: 99,
        name: "测试俱乐部",
        power: 20000,
        redQuench: 8,
        score: 321,
        announcement: "",
      },
    ],
  );
  assert.equal(name, "黄金积分详情_2026-11-14.xlsx");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["黄金积分详情"], {
    header: 1,
  });
  assert.equal(rows[0][7], "黄金积分");
  assert.equal(rows[1][3], "测试俱乐部");
  assert.ok(rows.some((row) => row[0] === "联盟名称"));
  assert.ok(rows.some((row) => row[0] === "总计" && row[1] === 1));
});

test("俱乐部战绩导出保留两个工作表和战斗记录", async () => {
  const { name, workbook } = await exportedWorkbook(
    "clubBattleUtils",
    "formatBattleRecordsForExport",
    [
      {
        roleId: 1,
        name: "甲",
        winCnt: 3,
        loseCnt: 1,
        buildingCnt: 2,
        targetRoleList: [
          {
            roleInfo: { roleId: 1, name: "甲" },
            targetRoleInfo: { roleId: 2, name: "乙" },
            attackType: 1,
            newWinFlag: 1,
            timestamp: 1730000000,
          },
        ],
      },
    ],
  );
  assert.equal(name, "俱乐部战绩_2026-11-14.xlsx");
  assert.deepEqual(workbook.SheetNames, ["战绩数据", "战斗数据"]);
  const members = XLSX.utils.sheet_to_json(workbook.Sheets["战绩数据"], {
    header: 1,
  });
  const battles = XLSX.utils.sheet_to_json(workbook.Sheets["战斗数据"], {
    header: 1,
  });
  assert.equal(members[1][2], "甲");
  assert.equal(members[2][0], "总计");
  assert.equal(battles[1][1], "甲");
  assert.equal(battles[1][3], "乙");
});

test("盐场统计三种视图能导出真实可读的 xlsx", async () => {
  const vue = await readFile(
    new URL("../src/components/Club/LegionWarStatistics.vue", import.meta.url),
    "utf8",
  );
  const script = vue.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const ast = ts.createSourceFile(
    "LegionWarStatistics.js",
    script,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) => item.name.getText(ast) === "exportExcel",
      ),
  );
  assert.ok(declaration);
  const { outputText } = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  for (const [view, dataName, row] of [
    [
      "legion",
      "legionData",
      {
        name: "测试俱乐部",
        killCnt: 3,
        reviveCount: 1,
        score: 12,
        redCount: 5,
        power: 100,
        participantsCount: 2,
        danCount: 1,
        blessingCount: 0,
        blessingScore: 0,
      },
    ],
    [
      "individual",
      "individualData",
      {
        name: "测试成员",
        kill: 3,
        die: 1,
        revive: 0,
        score: 12,
        digGround: 1,
        dan: 0,
        kd: 3,
      },
    ],
    [
      "all_individual",
      "allIndividualData",
      {
        name: "测试成员",
        clubName: "测试俱乐部",
        kill: 3,
        die: 1,
        revive: 0,
        score: 12,
        digGround: 1,
        dan: 0,
        kd: 3,
      },
    ],
  ]) {
    let file;
    const context = {
      validData: { value: true },
      viewMode: { value: view },
      [dataName]: { value: [row] },
      message: { warning() {}, success() {} },
      getCurrentTimeByFormat: () => "20261114_120000",
      formatPower: (value) => String(value),
      require: (name) => {
        assert.equal(name, "xlsx");
        return {
          ...XLSX,
          writeFile: (workbook, filename) => {
            file = { workbook, filename };
          },
        };
      },
    };
    vm.createContext(context);
    vm.runInContext(`${outputText}\nglobalThis.run = exportExcel;`, context);
    await context.run();
    assert.match(file.filename, /^盐场.+_20261114_120000\.xlsx$/);
    const binary = XLSX.write(file.workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    const parsed = XLSX.read(binary, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(parsed.Sheets.Sheet1, { header: 1 });
    assert.equal(rows[0][0], "排名");
    assert.equal(rows[1][1], row.name);
  }
});

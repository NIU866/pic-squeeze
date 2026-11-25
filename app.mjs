import { encode, formats, imageType, outputName } from "./image-ops.mjs";
import { zipSync } from "./vendor/zip.mjs";

const $ = id => document.getElementById(id);
const items = [];
let busy = false;
const MAX_FILE_BYTES = 30 * 1024 ** 2;

function size(value) {
  return value >= 1024 ** 2 ? (value / 1024 ** 2).toFixed(2) + " MB" :
    value >= 1024 ? (value / 1024).toFixed(1) + " KB" : value + " B";
}

function element(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function status(message) {
  $("status").textContent = message;
}

function cleanOutput(item) {
  if (item.result) URL.revokeObjectURL(item.result.url);
  item.result = null;
  item.error = "";
}

function render() {
  const results = items.filter(item => item.result);
  const original = items.reduce((total, item) => total + item.file.size, 0);
  const originalCompared = results.reduce((total, item) => total + item.file.size, 0);
  const compressed = results.reduce((total, item) => total + item.result.blob.size, 0);
  const delta = originalCompared ? (compressed - originalCompared) / originalCompared * 100 : 0;
  $("count").textContent = items.length + " 张";
  $("original").textContent = items.length ? size(original) : "—";
  $("compressed").textContent = results.length ? size(compressed) : "—";
  $("difference").textContent = results.length ? (delta > 0 ? "+" : "") + delta.toFixed(1) + "%" : "—";
  $("empty").hidden = Boolean(items.length);
  for (const id of ["add", "format", "limit"]) $(id).disabled = busy;
  $("quality").disabled = busy || $("format").value === "image/png";
  $("clear").disabled = busy || !items.length;
  $("run").disabled = busy || !items.length;
  $("archive").disabled = busy || !results.length;
  $("items").replaceChildren();
  for (const item of items) {
    const result = item.result;
    const row = element($("items"), "li");
    const frame = element(row, "div", result ? "" : formats[item.type].label, "thumb");
    if (result) {
      const preview = element(frame, "img");
      preview.src = result.url;
      preview.alt = "";
    }
    const info = element(row, "div", null, "file-info");
    element(info, "strong", item.file.name);
    const detail = result ? size(item.file.size) + " → " + size(result.blob.size) + " · " +
      formats[result.type].label + " · " + result.width + " × " + result.height :
      size(item.file.size) + " · " + (item.error || "待处理");
    element(info, "small", detail);
    const controls = element(row, "div", null, "item-buttons");
    if (result) {
      const download = element(controls, "a", "下载", "download");
      download.href = result.url;
      download.download = result.name;
      download.setAttribute("aria-label", "下载 " + result.name);
    }
    const remove = element(controls, "button", "移除");
    remove.disabled = busy;
    remove.setAttribute("aria-label", "移除 " + item.file.name);
    remove.addEventListener("click", () => {
      cleanOutput(item);
      items.splice(items.indexOf(item), 1);
      render();
    });
  }
}

function addFiles(files) {
  if (busy || !files.length) return;
  let added = 0;
  const rejected = [];
  for (const file of files) {
    if (items.length >= 50) { rejected.push("列表最多 50 张图片"); break; }
    const type = imageType(file);
    if (!type || file.size > MAX_FILE_BYTES || !file.size) {
      rejected.push(file.name + " · 请选择 30 MB 以内的 JPG、PNG 或 WebP");
      continue;
    }
    items.push({ file, type, result:null, error:"" });
    added += 1;
  }
  status([added ? "已加入 " + added + " 张图片。" : "", ...rejected].filter(Boolean).join(" "));
  render();
}

async function run() {
  if (busy || !items.length) return;
  const limitField = $("limit");
  const limit = limitField.value === "" ? 0 : limitField.valueAsNumber;
  if (!limitField.validity.valid || !Number.isInteger(limit) || limit < 0 || limit > 16384) {
    status("最长边请填写 0 到 16384 之间的整数。");
    return;
  }
  const quality = Number($("quality").value) / 100;
  const outputFormat = $("format").value;
  busy = true;
  items.forEach(cleanOutput);
  render();
  const names = new Set();
  let successes = 0;
  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const type = outputFormat === "original" ? item.type : outputFormat;
      status("正在处理 " + (index + 1) + " / " + items.length + " · " + item.file.name);
      try {
        const result = await encode(item.file, type, quality, limit);
        item.result = { ...result, name:outputName(item.file.name, type, names), url:URL.createObjectURL(result.blob) };
        successes += 1;
      } catch (error) {
        item.error = error?.message || "图片处理失败";
      }
    }
  } finally {
    busy = false;
    render();
  }
  status("已处理 " + successes + " / " + items.length + " 张图片。" +
    (successes < items.length ? "请按列表中的提示检查失败项。" : ""));
}

async function archive() {
  if (busy) return;
  const results = items.flatMap(item => item.result ? [item.result] : []);
  if (!results.length) return;
  if (results.reduce((sum, result) => sum + result.blob.size, 0) > 160 * 1024 ** 2) {
    status("总导出超过 160 MB，可按张下载或分批处理。");
    return;
  }
  busy = true;
  render();
  status("正在打包图片…");
  try {
    const files = Object.create(null);
    for (const result of results) files[result.name] = new Uint8Array(await result.blob.arrayBuffer());
    const bytes = zipSync(files, { level:0 });
    const url = URL.createObjectURL(new Blob([bytes], { type:"application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "压缩图片.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status("已生成包含 " + results.length + " 张图片的 ZIP。");
  } catch {
    status("打包失败。可按张下载或分批处理。");
  } finally {
    busy = false;
    render();
  }
}

$("add").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", () => {
  const files = [...$("files").files];
  $("files").value = "";
  addFiles(files);
});
const drop = $("drop");
drop.addEventListener("dragover", event => {
  if (event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
    if (!busy) drop.classList.add("is-over");
  }
});
drop.addEventListener("dragleave", event => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("is-over");
});
drop.addEventListener("drop", event => {
  event.preventDefault();
  drop.classList.remove("is-over");
  addFiles([...event.dataTransfer.files]);
});
for (const kind of ["dragover", "drop"]) {
  document.addEventListener(kind, event => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  });
}
$("format").addEventListener("change", () => {
  $("quality").disabled = $("format").value === "image/png";
});
$("quality").addEventListener("input", () => {
  $("quality-value").textContent = $("quality").value + "%";
});
$("run").addEventListener("click", run);
$("archive").addEventListener("click", archive);
$("clear").addEventListener("click", () => {
  items.forEach(cleanOutput);
  items.length = 0;
  status("图片列表已清空。");
  render();
});

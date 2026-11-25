export const formats = {
  "image/webp": { label:"WebP", extension:"webp" },
  "image/jpeg": { label:"JPEG", extension:"jpg" },
  "image/png": { label:"PNG", extension:"png" },
};

export function imageType(file) {
  if (Object.hasOwn(formats, file.type)) return file.type;
  const extension = file.name.split(".").at(-1).toLowerCase();
  const extensions = { webp:"image/webp", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg" };
  return Object.hasOwn(extensions, extension) ? extensions[extension] : "";
}

export function targetSize(width, height, limit) {
  const ratio = limit ? Math.min(1, limit / Math.max(width, height)) : 1;
  return [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))];
}

export function outputName(filename, format, used) {
  const clean = filename.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .trim().replace(/[. ]+$/, "");
  const base = Array.from(clean || "image").slice(0, 78).join("") + "-compressed";
  const extension = formats[format].extension;
  let index = 1;
  let candidate = base + "." + extension;
  while (used.has(candidate.toLowerCase())) {
    index += 1;
    candidate = base + "-" + index + "." + extension;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation:"from-image" });
      return { image:bitmap, width:bitmap.width, height:bitmap.height, close:() => bitmap.close() };
    } catch {
      // The native image element can decode some files that ImageBitmap rejects.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return { image, width:image.naturalWidth, height:image.naturalHeight, close:() => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw Error("无法读取这张图片");
  }
}

export async function encode(file, type, quality, limit) {
  const source = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    if (!source.width || !source.height || source.width * source.height > 40_000_000) {
      throw Error("最多支持 4000 万像素的原图");
    }
    const [width, height] = targetSize(source.width, source.height, limit);
    if (Math.max(width, height) > 16384) throw Error("请设置最长边以缩小图片");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("浏览器无法创建图像画布");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob) throw Error("编码失败，请尝试缩小尺寸");
    if (blob.type !== type) throw Error("浏览器暂不支持此输出格式");
    return { blob, width, height, type };
  } finally {
    source.close();
    canvas.width = canvas.height = 1;
  }
}

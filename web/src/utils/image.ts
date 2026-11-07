export interface PreparedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('无法读取该图片，请换成 JPG 或 PNG');
  }
}

/** 前端压缩：最长边 1600px，JPEG 0.85，兼顾题目文字清晰度与上传体积 */
export async function prepareImage(file: File, maxDim = 1600): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('当前浏览器不支持图片压缩');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('图片压缩失败，请重试');
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  const compressed = new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  return { file: compressed, previewUrl: URL.createObjectURL(blob), width, height };
}

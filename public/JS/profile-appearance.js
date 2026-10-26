import { setImageSource } from "./image-sources.js";
export const profileFrames = [
  ["none", "Sem moldura"],
  ["gold", "Dourada"],
  ["silver", "Prata"],
  ["fire", "Fogo"],
  ["water", "Água"],
  ["earth", "Terra"],
  ["air", "Ar"],
  ["zarcos", "Zarcos"],
];
export const profileSourceLimit = 8 * 1024 * 1024;
export function imageCrop(width, height, kind) {
  if (!width || !height || width * height > 40000000)
    throw Error("Use uma imagem de até 40 megapixels.");
  const maxWidth = kind === "banner" ? 1600 : 384,
    maxHeight = kind === "banner" ? 500 : 384,
    ratio = maxWidth / maxHeight;
  const sw = Math.min(width, height * ratio),
    sh = sw / ratio,
    scale = Math.min(1, maxWidth / sw);
  return {
    sx: (width - sw) / 2,
    sy: (height - sh) / 2,
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}
export function applyProfileAppearance({ avatar, cover }, appearance) {
  if (avatar) {
    setImageSource(avatar, appearance.avatarURL || "/assets/avatar.png");
    avatar.dataset.frame = profileFrames.some(
      ([id]) => id === appearance.avatarFrame,
    )
      ? appearance.avatarFrame
      : "none";
  }
  if (cover) {
    let image = cover.querySelector(":scope > .profile-banner-image");
    if (appearance.bannerURL) {
      if (!image) {
        image = document.createElement("img");
        image.className = "profile-banner-image";
        image.alt = "";
        cover.prepend(image);
      }
      setImageSource(image, appearance.bannerURL);
    } else image?.remove();
    cover.classList.toggle("custom-banner", !!appearance.bannerURL);
  }
}
export async function prepareProfileUpload(file, kind) {
  if (
    !file ||
    file.size > profileSourceLimit ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  )
    throw Error("Use PNG, JPG ou WebP de até 8 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error("Não foi possível ler a imagem. Use PNG, JPG ou WebP.");
  }
  const canvas = document.createElement("canvas");
  try {
    const crop = imageCrop(bitmap.width, bitmap.height, kind);
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw Error("Não foi possível preparar a imagem neste navegador.");
    context.drawImage(
      bitmap,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      crop.width,
      crop.height,
    );
    const encode = (type, quality) =>
      new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(Error("Não foi possível converter a imagem.")),
          type,
          quality,
        ),
      );
    let blob = await encode("image/webp", 0.82);
    if (blob.type !== "image/webp") blob = await encode("image/jpeg", 0.82);
    if (blob.size > 2 * 1024 * 1024) blob = await encode("image/jpeg", 0.65);
    if (blob.size > 2 * 1024 * 1024)
      throw Error(
        "A imagem continua muito grande após otimizar. Escolha outra imagem.",
      );
    const preview = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Falha ao preparar a prévia."));
      reader.readAsDataURL(blob);
    });
    return { blob, preview };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

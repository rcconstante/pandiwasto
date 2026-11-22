import { supabaseClient } from "./auth";

const photoBucket = () => {
  if (!supabaseClient) throw new Error("Profile storage is unavailable.");
  return supabaseClient.storage.from("player-photos");
};

export async function readPlayerPhoto(path: string) {
  const { data, error } = await photoBucket().createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadPlayerPhoto(userId: string, file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Couldn’t resize the photo.");
    context.fillStyle = "#fffdf3";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  } finally {
    bitmap.close();
  }
  const photo = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
  if (!photo) throw new Error("Couldn’t prepare the photo.");
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await photoBucket().upload(path, photo, { contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw error;
  return path;
}

export async function removePlayerPhoto(path: string) {
  await photoBucket().remove([path]);
}

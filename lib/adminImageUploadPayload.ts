export function createAdminImageUploadPayload(
  adminEmail: string,
  image: Buffer,
) {
  return {
    admin_email: adminEmail,
    image_b64: image.toString("base64"),
  };
}

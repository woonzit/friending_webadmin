export function createAdminVideoUploadPayload(
  adminEmail: string,
  video: Buffer,
) {
  return {
    admin_email: adminEmail,
    video_b64: video.toString("base64"),
  };
}

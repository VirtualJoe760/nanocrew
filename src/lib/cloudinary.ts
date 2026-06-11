import { v2 as cloudinary } from 'cloudinary';

// Server-side only (uses the API secret). Hosts generated designs so the app
// gets a small URL instead of a multi-MB base64 data blob.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Host a generated video (Veo output) — returns the secure delivery URL.
export function uploadVideo(buffer: Buffer, opts?: { folder?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'video', folder: opts?.folder ?? 'nanocrew/videos' },
      (err, res) => {
        if (err || !res) return reject(err ?? new Error('Cloudinary video upload failed'));
        resolve(res.secure_url);
      },
    );
    stream.end(buffer);
  });
}

export function uploadImage(
  buffer: Buffer,
  opts: { folder: string; publicId?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: opts.folder, public_id: opts.publicId, resource_type: 'image', overwrite: true },
      (err, res) => {
        if (err || !res) return reject(err ?? new Error('Cloudinary upload failed'));
        resolve(res.secure_url);
      },
    );
    stream.end(buffer);
  });
}

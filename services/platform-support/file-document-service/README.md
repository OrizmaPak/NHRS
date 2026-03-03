# file-document-service

NHRS cloud file handling service (Cloudinary-backed).

## Default Port

`8102`

## Endpoints

- `GET /health`
- `POST /files/upload` (multipart form-data with `file`)
- `DELETE /files/:publicId?resourceType=image|video|raw` (URL-encode `publicId` if it contains `/`)

## Required Env

- `CLOUDINARY_URL`
- `CLOUDINARY_UPLOAD_FOLDER` (optional, default `nhrs`)
- `MAX_FILE_SIZE_BYTES` (optional, default 10485760)

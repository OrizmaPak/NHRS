const fastify = require('fastify')({ logger: true });
const multipart = require('@fastify/multipart');
const { v2: cloudinary } = require('cloudinary');

const serviceName = 'file-document-service';
const port = Number(process.env.PORT) || 8102;
const cloudinaryUrl = process.env.CLOUDINARY_URL;
const uploadFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'nhrs';
const maxFileSize = Number(process.env.MAX_FILE_SIZE_BYTES) || 10 * 1024 * 1024;

let cloudinaryReady = false;

function uploadBufferToCloudinary(fileBuffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        return reject(error);
      }
      return resolve(result);
    });

    stream.end(fileBuffer);
  });
}

async function configureCloudinary() {
  if (!cloudinaryUrl) {
    fastify.log.warn('CLOUDINARY_URL is not set; upload endpoints will return 503');
    return;
  }

  cloudinary.config({
    secure: true,
  });

  cloudinaryReady = true;
  fastify.log.info({ uploadFolder }, 'Cloudinary configured');
}

fastify.register(multipart, {
  limits: {
    fileSize: maxFileSize,
    files: 1,
  },
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  cloudinaryReady,
  uploadFolder,
  maxFileSize,
}));

fastify.post('/files/upload', async (req, reply) => {
  if (!cloudinaryReady) {
    return reply.code(503).send({ message: 'File storage is not configured' });
  }

  const file = await req.file();
  if (!file) {
    return reply.code(400).send({ message: 'file is required (multipart/form-data)' });
  }

  const contentType = file.mimetype || 'application/octet-stream';

  let fileBuffer;
  try {
    fileBuffer = await file.toBuffer();
  } catch (err) {
    req.log.error({ err }, 'Failed to read uploaded file');
    return reply.code(400).send({ message: 'Invalid upload payload' });
  }

  try {
    const result = await uploadBufferToCloudinary(fileBuffer, {
      folder: uploadFolder,
      resource_type: 'auto',
      filename_override: file.filename,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
      tags: ['nhrs', 'file-document-service'],
      context: {
        source: serviceName,
        mimeType: contentType,
      },
    });

    return reply.code(201).send({
      message: 'File uploaded successfully',
      file: {
        publicId: result.public_id,
        url: result.url,
        secureUrl: result.secure_url,
        format: result.format || null,
        resourceType: result.resource_type,
        bytes: result.bytes,
        width: result.width || null,
        height: result.height || null,
        originalFilename: file.filename,
        contentType,
        createdAt: result.created_at,
      },
    });
  } catch (err) {
    req.log.error({ err }, 'Cloudinary upload failed');
    return reply.code(502).send({ message: 'Failed to upload file to cloud storage' });
  }
});

fastify.delete('/files/:publicId', async (req, reply) => {
  if (!cloudinaryReady) {
    return reply.code(503).send({ message: 'File storage is not configured' });
  }

  const { publicId } = req.params;
  const query = req.query || {};
  const resourceType = ['image', 'video', 'raw'].includes(query.resourceType)
    ? query.resourceType
    : 'image';
  if (!publicId) {
    return reply.code(400).send({ message: 'publicId is required' });
  }

  const decodedPublicId = decodeURIComponent(publicId);

  try {
    const result = await cloudinary.uploader.destroy(decodedPublicId, {
      resource_type: resourceType,
      invalidate: true,
    });

    if (result.result === 'not found') {
      return reply.code(404).send({ message: 'File not found' });
    }

    return reply.send({ message: 'File deleted successfully', result });
  } catch (err) {
    req.log.error({ err }, 'Cloudinary delete failed');
    return reply.code(502).send({ message: 'Failed to delete file from cloud storage' });
  }
});

const start = async () => {
  try {
    await configureCloudinary();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

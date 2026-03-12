import fs from 'node:fs/promises';
import path from 'node:path';

const linearApiKey = process.env.LINEAR_API_KEY;
const endpoint = process.env.LINEAR_GRAPHQL_URL ?? 'https://api.linear.app/graphql';
const files = process.argv.slice(2);

if (!linearApiKey) {
  console.error('LINEAR_API_KEY is required');
  process.exit(1);
}

if (files.length === 0) {
  console.error('usage: node ./scripts/upload-linear-assets.mjs <file> [file...]');
  process.exit(1);
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

async function linearGraphQL(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: linearApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`linear graphql failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`linear graphql errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

async function uploadFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const file = await fs.readFile(absolutePath);
  const stat = await fs.stat(absolutePath);
  const filename = path.basename(absolutePath);
  const contentType = contentTypeFor(absolutePath);

  const data = await linearGraphQL(
    `mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
      fileUpload(filename: $filename, contentType: $contentType, size: $size, makePublic: true) {
        success
        uploadFile {
          uploadUrl
          assetUrl
          headers {
            key
            value
          }
        }
      }
    }`,
    {
      filename,
      contentType,
      size: stat.size,
    }
  );

  const upload = data.fileUpload?.uploadFile;
  if (!upload?.uploadUrl || !upload?.assetUrl) {
    throw new Error(`linear upload url missing for ${filename}`);
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  for (const header of upload.headers ?? []) {
    headers.set(header.key, header.value);
  }

  const putResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers,
    body: file,
  });

  if (!putResponse.ok) {
    throw new Error(`asset upload failed for ${filename}: ${putResponse.status} ${putResponse.statusText}`);
  }

  return {
    assetUrl: upload.assetUrl,
    contentType,
    filename,
    markdown: `![${filename}](${upload.assetUrl})`,
    path: absolutePath,
    size: stat.size,
  };
}

const uploaded = [];
for (const filePath of files) {
  uploaded.push(await uploadFile(filePath));
}

console.log(JSON.stringify(uploaded, null, 2));

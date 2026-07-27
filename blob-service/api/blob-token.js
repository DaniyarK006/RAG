const { handleUpload } = require('@vercel/blob/client');
const jwt = require('jsonwebtoken');

module.exports = async (request, response) => {
  const body = request.body;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!clientPayload) {
          throw new Error('Missing token');
        }
        try {
          jwt.verify(clientPayload, process.env.JWT_SECRET);
        } catch {
          throw new Error('Invalid token');
        }
        return {
          allowedContentTypes: ['*/*'],
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async () => {},
    });

    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
};
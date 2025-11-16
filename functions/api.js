
// This function is mapped to the `/api` route.
// It has been completely rewritten to use the `gemini-2.5-flash-image` model
// for actual image editing (virtual try-on), which was the original goal.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed. Only POST is accepted.' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { GEMINI_API_KEY } = context.env;
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'CRITICAL: Missing GEMINI_API_KEY in Cloudflare environment variables.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const requestBody = await context.request.json();
    const { imageBase64, mimeType, prompt } = requestBody;
    
    if (!imageBase64 || !mimeType || !prompt) {
      return new Response(JSON.stringify({ error: 'Client Error: Missing imageBase64, mimeType, or prompt.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // This is the correct model for image generation/editing
    const model = 'gemini-2.5-flash-image';
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiApiBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      }],
      // CRITICAL: This config tells the API to return an IMAGE
      config: {
          responseModalities: ['IMAGE'],
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };

    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiApiBody),
    });

    const responseText = await geminiResponse.text();
    if (!geminiResponse.ok) {
        console.error("Google API Error Response Text:", responseText);
        let detailedMessage = 'An unknown error occurred with Google AI.';
        try {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error?.message) {
                detailedMessage = `Google API Error: ${errorJson.error.message}`;
            }
        } catch(e) {
             detailedMessage = `Google API returned a non-JSON error: ${responseText}`;
        }
        return new Response(JSON.stringify({ error: `Google API failed with status ${geminiResponse.status}. Details: ${detailedMessage}` }), {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    }

    const responseData = JSON.parse(responseText);
    
    // Find the part in the response that contains the image data
    const imagePart = responseData.candidates?.[0]?.content?.parts?.find(part => part.inline_data);

    if (!imagePart) {
      console.error("Invalid response structure from Google API - no image part found:", responseData);
      return new Response(JSON.stringify({ error: 'Could not find the edited image in the Google API response.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    
    const newImageBase64 = imagePart.inline_data.data;

    return new Response(JSON.stringify({ newImageBase64: newImageBase64 }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error in Cloudflare function:', error);
    return new Response(JSON.stringify({ error: `An unexpected server error occurred: ${error.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

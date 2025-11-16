
// This function is mapped to the `/api` route.
// It's rewritten to use the Gemini API (which accepts a simple API key)
// to provide style advice instead of editing an image.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  // Handle CORS preflight requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Ensure the request is a POST request
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: `Method Not Allowed. Only POST requests are accepted at /api.` }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Get the Gemini API Key from environment variables
    // IMPORTANT: The variable name is now GEMINI_API_KEY
    const { GEMINI_API_KEY } = context.env;
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'CRITICAL: Missing GEMINI_API_KEY in Cloudflare environment variables.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse the incoming request body
    const requestBody = await context.request.json();
    const { imageBase64, mimeType, prompt: glassesStyle } = requestBody;
    
    if (!imageBase64 || !mimeType || !glassesStyle) {
      return new Response(JSON.stringify({ error: 'Client Error: Missing required fields. imageBase64, mimeType, and prompt are required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 3. Construct the detailed prompt for the AI stylist
    const fullPrompt = `You are an expert fashion stylist specializing in eyewear, writing for a premium brand called SENATOR OPTICS. Analyze the provided image of a person's face. The user wants to know how a specific style of glasses would look on them. The glasses style is: "${glassesStyle}".

Provide a helpful, positive, and descriptive style recommendation in Persian. Structure your response using Markdown for better readability. Cover these points:
- **تحلیل چهره:** How well would this style of glasses complement the person's face shape?
- **ایجاد استایل:** What kind of impression or look would these glasses create (e.g., professional, trendy, classic)?
- **پیشنهاد ست:** Suggest one or two occasions or outfits these glasses would be perfect for.

Keep the tone encouraging, luxurious, and fashionable. Start with a welcoming sentence. Respond only in Persian.`;

    // 4. Construct the request body for the Gemini API
    const geminiApiBody = {
      contents: [{
        parts: [
          { text: fullPrompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      }],
      // Add safety settings to prevent harmful content
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };

    // 5. Construct the Gemini API endpoint URL
    const model = 'gemini-pro-vision'; // This model can understand images and text
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    // 6. Make the fetch request to the Google Gemini API
    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiApiBody),
    });

    // 7. Handle the response from Google
    const responseText = await geminiResponse.text();
    if (!geminiResponse.ok) {
        console.error("Google API Error Response Text:", responseText);
        let detailedMessage = 'An unknown error occurred while communicating with Google AI.';
        try {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error?.message) {
                detailedMessage = `Google API Error: ${errorJson.error.message}`;
            }
        } catch(e) {
             detailedMessage = `Google API returned a non-JSON error: ${responseText}`;
        }
        return new Response(JSON.stringify({ error: `Google API failed with status ${geminiResponse.status}. Details: ${detailedMessage}` }), {
            status: 502, // Bad Gateway
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    }

    // 8. Extract the style advice text from the response
    const responseData = JSON.parse(responseText);
    const styleAdvice = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!styleAdvice) {
      console.error("Invalid response structure from Google API:", responseData);
      return new Response(JSON.stringify({ error: 'Could not find the style advice in the Google API response.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    
    // 9. Send the successful response back to the client
    return new Response(JSON.stringify({ styleAdvice: styleAdvice }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('An unexpected error occurred in the Cloudflare function:', error);
    return new Response(JSON.stringify({ error: `An unexpected server error occurred: ${error.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

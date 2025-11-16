
// This creates a "catch-all" route. Any request to a path that doesn't
// match a static asset (like /api) will be handled by this function when
// deployed via the Git-connected method on Cloudflare Pages.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Main handler for ALL incoming requests.
export async function onRequest(context) {
  // Handle CORS preflight requests (OPTIONS method)
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // We only care about POST requests to /api
  const url = new URL(context.request.url);
  if (url.pathname !== '/api' || context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: `Method Not Allowed or Invalid Path. Only POST to /api is accepted.` }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // --- Start of POST request logic for /api ---
  try {
    // 1. Get environment variables from the context
    const { GCP_API_KEY, GCP_PROJECT_ID } = context.env;
    if (!GCP_API_KEY || !GCP_PROJECT_ID) {
      return new Response(JSON.stringify({ error: 'CRITICAL: Missing GCP_API_KEY or GCP_PROJECT_ID in Cloudflare environment variables.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse the incoming request body
    const requestBody = await context.request.json();
    const { imageBase64, mimeType, prompt } = requestBody;
    
    if (!imageBase64 || !mimeType || !prompt) {
      return new Response(JSON.stringify({ error: 'Client Error: Missing required fields. imageBase64, mimeType, and prompt are required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 3. Construct the request body for the Google Vertex AI API
    const vertexAIBody = {
      instances: [{
        prompt: prompt,
        image: { bytesBase64Encoded: imageBase64 },
      }],
      parameters: { sampleCount: 1 },
    };

    // 4. Construct the Google Vertex AI API endpoint URL
    // CORRECT AUTHENTICATION: For this API, the API key is passed as a query parameter.
    const model = 'imagegeneration@006'; // Using the latest stable model
    const vertexAIEndpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/${model}:predict?key=${GCP_API_KEY}`;
    
    // 5. Make the fetch request to the Google API
    const vertexAIResponse = await fetch(vertexAIEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(vertexAIBody),
    });

    // 6. Handle the response from Google with detailed error logging
    const responseText = await vertexAIResponse.text();
    if (!vertexAIResponse.ok) {
        console.error("Google API Error Response Text:", responseText);
        let detailedMessage = 'An unknown error occurred while communicating with Google AI.';
        try {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error?.message) {
                detailedMessage = `Google API Error: ${errorJson.error.message}. This could mean the Vertex AI API is not enabled on your Google Cloud project or there is a billing issue.`;
            }
        } catch(e) {
             detailedMessage = `Google API returned a non-JSON error: ${responseText}`;
        }
        return new Response(JSON.stringify({ error: `Google API failed with status ${vertexAIResponse.status}. Details: ${detailedMessage}` }), {
            status: 502, // Bad Gateway
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    }

    // 7. Extract the edited image data from the prediction
    const responseData = JSON.parse(responseText);
    const newBase64 = responseData?.predictions?.[0]?.bytesBase64Encoded;
    if (!newBase64) {
      console.error("Invalid response structure from Google API:", responseData);
      return new Response(JSON.stringify({ error: 'Could not find the edited image in the Google API response. The structure might have changed.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    
    // 8. Send the successful response back to the client
    return new Response(JSON.stringify({ newBase64: newBase64 }), {
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

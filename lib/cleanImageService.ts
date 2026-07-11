import * as FileSystem from 'expo-file-system/legacy';

const BACKEND_URL = 'http://192.168.1.149:3000';

export async function cleanImage(
  imageUri: string,
  userId: string,
  category: string
) {
  const startedAt = Date.now();

  const base64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: 'base64' as any,
  });

  console.log('━━━━━━━━━━━━━━━━━━━━');
  console.log('Uploading image...');
  console.log('Category:', category);
  console.log('Base64 length:', base64.length);

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 120000);

  try {
    const response = await fetch(`${BACKEND_URL}/upload/image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        imageBase64: base64,
        userId,
        category,
      }),
    });

    clearTimeout(timeout);

    const text = await response.text();

    let result: any;

    try {
      result = JSON.parse(text);
    } catch {
      console.log(text);
      throw new Error('Backend returned invalid JSON');
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Cleaning failed');
    }

    console.log(
      `Finished in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`
    );

    return result.data.cleanedImage;
  } catch (error: any) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }

    throw error;
  }
}
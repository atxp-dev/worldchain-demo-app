'use client';

import { useAtxp } from '@/contexts/atxpContext';
import { Button, TextArea, Typography } from '@worldcoin/mini-apps-ui-kit-react';
import { useState, useCallback } from 'react';
import Image from 'next/image';
import { useProgressiveMessage } from '@/hooks/useProgressiveMessage';
import { MiniKit } from '@worldcoin/minikit-js';

const WAITING_MESSAGES = [
  'Creating your image...',
  'Image MCP server working...',
  'Processing your request...',
  'Check out https://docs.atxp.ai for more information',
  'Generating pixels...',
  'Almost ready...',
  'Only a few more seconds...',
  'Putting finishing touches...',
  'This usually takes 1-2 minutes...',
  'Thanks for your patience...'
];

export const ImageGenerator = () => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { generateImage, waitForImage } = useAtxp();

  const waitingMessage = useProgressiveMessage({
    messages: WAITING_MESSAGES,
    interval: 3000 // Change message every 3 seconds
  });

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isGenerating || isWaiting) {
      return;
    }

    setError(null);
    setGeneratedImageUrl(null);
    setIsGenerating(true);

    try {
      // Generate the image
      const result = await generateImage({
        prompt: prompt.trim(),
        messageId: crypto.randomUUID(),
      });

      if (result.isError) {
        setError(result.error || 'Failed to generate image');
        return;
      }

      if (!result.taskId) {
        setError('No task ID received');
        return;
      }

      setIsGenerating(false);
      setIsWaiting(true);

      // Wait for the image to be ready
      const imageUrl = await waitForImage({ taskId: result.taskId });

      if (imageUrl) {
        setGeneratedImageUrl(imageUrl);
        MiniKit.commands.sendHapticFeedback({
          hapticsType: 'notification',
          style: 'success',
        });
      } else {
        setError('Failed to retrieve generated image');
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
      setIsWaiting(false);
    }
  }, [prompt, generateImage, waitForImage, isGenerating, isWaiting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const isLoading = isGenerating || isWaiting;

  const handleShare = useCallback(async () => {
    if (!generatedImageUrl) return;

    try {
      await MiniKit.commandsAsync.share({
        title: 'AI Generated Image',
        text: `Check out this AI generated image from: "${prompt}"`,
        url: generatedImageUrl,
      });
    } catch (err) {
      console.error('Failed to share image:', err);
    }
  }, [generatedImageUrl, prompt]);

  return (
    <div className="w-full max-w-2xl mx-auto p-4 bg-white rounded-lg border-2 border-gray-200">
      <Typography variant="h2" className="mb-4">AI Image Generator</Typography>

      <div className="space-y-4">
        <div>
          <Typography variant="label" className="block mb-2">
            Image Prompt
          </Typography>
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the image you want to generate... (Ctrl/Cmd + Enter to submit)"
            disabled={isLoading}
            rows={4}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || isLoading}
          variant="primary"
          size="lg"
          className="w-full"
        >
          {isGenerating && 'Generating Image...'}
          {isWaiting && 'Creating Image...'}
          {!isLoading && 'Generate Image'}
        </Button>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <Typography variant="body-sm" className="text-red-700">{error}</Typography>
          </div>
        )}

        {generatedImageUrl && (
          <div className="mt-6">
            <Typography variant="h3" className="mb-2">Generated Image:</Typography>
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <Image
                src={generatedImageUrl}
                alt="Generated image"
                width={800}
                height={600}
                className="w-full h-auto"
                onError={() => setError('Failed to load generated image')}
                unoptimized
              />
            </div>
            <div className="mt-4">
              <Button
                onClick={handleShare}
                variant="secondary"
                size="lg"
                className="w-full"
              >
                Share Image
              </Button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <Typography variant="body-sm" className="text-gray-600">
                {isGenerating && 'Submitting your request...'}
                {isWaiting && waitingMessage}
              </Typography>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
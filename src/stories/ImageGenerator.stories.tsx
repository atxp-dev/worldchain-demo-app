import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Button, TextArea, Typography } from '@worldcoin/mini-apps-ui-kit-react';

// Create a mock version of the ImageGenerator for Storybook
const MockImageGenerator = () => {
  const [prompt, setPrompt] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = React.useCallback(() => {
    if (!prompt.trim() || isLoading) return;

    setError(null);
    setGeneratedImageUrl(null);
    setIsLoading(true);

    // Simulate image generation
    setTimeout(() => {
      const randomId = Math.random().toString(36).substring(2, 15);
      setGeneratedImageUrl(`https://picsum.photos/800/600?random=${randomId}`);
      setIsLoading(false);
    }, 2000);
  }, [prompt, isLoading]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleShare = React.useCallback(() => {
    console.log('Sharing image:', generatedImageUrl);
    alert('Share functionality would open here!');
  }, [generatedImageUrl]);

  const handleError = () => {
    setError('Example error: Failed to generate image');
    setIsLoading(false);
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4 bg-white rounded-lg border-2 border-gray-200">
      <Typography variant="heading" level={1} as="h2" className="mb-4 text-gray-900">AI Image Generator</Typography>

      <div className="space-y-4">
        <div>
          <TextArea
            label="Image Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={4}
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading}
            variant="primary"
            size="lg"
            className="flex-1"
          >
            {isLoading ? 'Generating Image...' : 'Generate Image'}
          </Button>

          <Button
            onClick={handleError}
            disabled={isLoading}
            variant="secondary"
            size="lg"
            className="border-red-600 text-red-600 hover:bg-red-50"
          >
            Simulate Error
          </Button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <Typography variant="body" level={2} className="text-red-700">{error}</Typography>
          </div>
        )}

        {generatedImageUrl && (
          <div className="mt-6">
            <Typography variant="heading" level={2} as="h3" className="mb-2 text-gray-800">Generated Image:</Typography>
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <img
                src={generatedImageUrl}
                alt="Generated image"
                className="w-full h-auto"
                onError={() => setError('Failed to load generated image')}
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
              <Typography variant="body" level={2} className="text-gray-600">
                Creating your image...
              </Typography>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const meta: Meta<typeof MockImageGenerator> = {
  title: 'Components/ImageGenerator',
  component: MockImageGenerator,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'AI Image Generator component with haptic feedback and sharing capabilities. This is a mock version for Storybook that simulates the functionality without requiring API connections.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px', padding: '20px', minHeight: '600px' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: 'Default State',
};

export const WithPrompt: Story = {
  name: 'With Sample Prompt',
  render: () => {
    const Component = MockImageGenerator;
    return <Component />;
  },
};

export const WithGeneratedImage: Story = {
  name: 'With Generated Image',
  render: () => {
    const MockImageGeneratorWithImage = () => {
      const [prompt] = React.useState('A beautiful sunset over a mountain range with snow-capped peaks');
      const [generatedImageUrl] = React.useState('https://picsum.photos/800/600?random=sunset');

      const handleShare = React.useCallback(() => {
        console.log('Sharing image:', generatedImageUrl);
        alert('Share functionality would open here!');
      }, [generatedImageUrl]);

      return (
        <div className="w-full max-w-2xl mx-auto p-4 bg-white rounded-lg border-2 border-gray-200">
          <Typography variant="heading" level={1} as="h2" className="mb-4 text-gray-900">AI Image Generator</Typography>

          <div className="space-y-4">
            <div>
              <TextArea
                label="Image Prompt"
                value={prompt}
                readOnly
                rows={4}
              />
            </div>

            <Button
              disabled
              variant="primary"
              size="lg"
              className="w-full bg-green-600 hover:bg-green-700"
            >
              ✓ Image Generated
            </Button>

            <div className="mt-6">
              <Typography variant="heading" level={2} as="h3" className="mb-2 text-gray-800">Generated Image:</Typography>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <img
                  src={generatedImageUrl}
                  alt="Generated image"
                  className="w-full h-auto"
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
          </div>
        </div>
      );
    };

    return <MockImageGeneratorWithImage />;
  },
};

export const Documentation: Story = {
  name: 'Component Documentation',
  parameters: {
    docs: {
      description: {
        story: `
### Features

- **Text Input**: Users can describe the image they want to generate
- **Keyboard Shortcuts**: Ctrl/Cmd + Enter to submit
- **Loading States**: Shows progress during generation
- **Error Handling**: Displays errors if generation fails
- **Image Display**: Shows generated images with proper error handling
- **Share Functionality**: Allows sharing generated images via World MiniApp share API
- **Haptic Feedback**: Provides tactile feedback on successful generation

### Usage

\`\`\`tsx
import { ImageGenerator } from '@/components/ImageGenerator';

function App() {
  return <ImageGenerator />;
}
\`\`\`

### Dependencies

- Uses \`@worldcoin/mini-apps-ui-kit-react\` for UI components
- Integrates with World MiniApp APIs for haptic feedback and sharing
- Requires ATXP context for image generation
        `,
      },
    },
  },
  render: () => null,
};
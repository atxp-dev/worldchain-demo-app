import type { Preview } from '@storybook/nextjs-vite'
import React from 'react'
import '@worldcoin/mini-apps-ui-kit-react/styles.css'
import '../src/app/globals.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        {
          name: 'light',
          value: '#ffffff',
        },
        {
          name: 'dark',
          value: '#333333',
        },
      ],
    },
    // Force light mode for consistent component preview
    theme: 'light',
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo'
    }
  },
  // Global decorator to ensure light mode styling
  decorators: [
    (Story) => (
      <div className="bg-white text-gray-900 min-h-screen p-4">
        <Story />
      </div>
    ),
  ],
};

export default preview;
import { useState, useEffect } from 'react';

interface ProgressiveMessageConfig {
  messages: string[];
  interval: number; // milliseconds between message changes
}

export const useProgressiveMessage = ({ messages, interval }: ProgressiveMessageConfig) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, interval);

    return () => clearInterval(timer);
  }, [messages.length, interval]);

  // Reset to first message when messages change
  useEffect(() => {
    setCurrentMessageIndex(0);
  }, [messages]);

  return messages[currentMessageIndex] || messages[0];
};
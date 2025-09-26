"use client";

import { WorldchainAccount, createMiniKitWorldchainAccount } from "@atxp/worldchain";
import { atxpClient } from "@atxp/client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MiniKit } from '@worldcoin/minikit-js';
// import ky from "ky";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAccount } from "wagmi";
import { useSession } from "next-auth/react";
import {
  GeneratedResult,
} from "@/types/ai.type";

interface AtxpContextType {
  atxpAccount: WorldchainAccount | null;
  generateImage: (args: {
    prompt: string;
    messageId: string;
  }) => Promise<GeneratedResult>;
  waitForImage: (args: { taskId: string }) => Promise<string | null>;
}

const AtxpContext = createContext<AtxpContextType | undefined>(undefined);

export const IMAGE_SERVICE = {
  mcpServer: "https://image.mcp.atxp.ai/",
  createImageToolName: "image_create_image",
  createImageAsyncToolName: "image_create_image_async",
  getImageAsyncToolName: "image_get_image_async",
  description: "ATXP Image MCP server",
  getArguments: (prompt: string) => ({ prompt }),
  getWaitForImageArguments: (taskId: string) => ({
    taskId,
    timeoutSeconds: 600, // Increase to 10 minutes
  }),
  getResult: (result: {content: [{text: string}]}) => {
    console.log("image result", JSON.stringify(result, null, 2));
    // Handle different result formats based on service
    if (
      result.content &&
      Array.isArray(result.content) &&
      result.content[0]?.text
    ) {
      try {
        const parsedResult = JSON.parse(result.content[0].text);
        return parsedResult.url;
      } catch {
        return JSON.parse(result.content[0].text);
      }
    } else {
      return result.content[0].text;
    }
  },
  getAsyncCreateResult: (result: {content: [{text: string}]}) => {
    console.log("image create result", JSON.stringify(result, null, 2));
    const jsonResult = result.content[0].text;
    const parsed = JSON.parse(jsonResult);
    return { taskId: parsed.taskId };
  },
  getAsyncStatusResult: (result: {content: [{text: string}]}) => {
    console.log("image status result", JSON.stringify(result, null, 2));
    return JSON.parse(result.content[0].text);
  },
};

export const useAtxp = () => {
  const context = useContext(AtxpContext);
  if (!context) {
    throw new Error(
      "useEnvironment must be used within an EnvironmentProvider",
    );
  }
  return context;
};

interface AtxpProviderProps {
  children: ReactNode;
}

export const AtxpProvider = ({ children }: AtxpProviderProps) => {
  const [atxpAccount, setAtxpAccount] = useState<WorldchainAccount | null>(null);
  const [atxpImageClient, setAtxpImageClient] = useState<Client | null>(null);

  const { address } = useAccount();
  const { data: session } = useSession();

  const loadWorldhainAccountForWallet = useCallback(async () => {
    // Try to get wallet address from wagmi first, then from session
    const walletAddress = address || session?.user?.walletAddress;

    if (!walletAddress) {
      return null;
    }
    const tmpAtxpAccount = await createMiniKitWorldchainAccount({walletAddress, miniKit: MiniKit});

    setAtxpAccount(tmpAtxpAccount);
    return tmpAtxpAccount;
  }, [address, session?.user?.walletAddress]);

  // Auto-initialize ATXP account when we get an address (wagmi or session)
  useEffect(() => {
    const walletAddress = address || session?.user?.walletAddress;

    if (walletAddress && !atxpAccount) {
      console.log("Triggering ATXP account initialization - walletAddress:", walletAddress);
      loadWorldhainAccountForWallet();
    }
  }, [address, session?.user?.walletAddress, atxpAccount, loadWorldhainAccountForWallet]);

  const createImageClient = useCallback(async (atxpAccount: WorldchainAccount) => {
    const imageClient = await atxpClient({
      account: atxpAccount,
      mcpServer: IMAGE_SERVICE.mcpServer,
      onPayment: async ({ payment }) => {
        console.log("🎉 ATXP Payment callback triggered:", payment);
      },
      onPaymentFailure: async ({ payment, error }) => {
        console.log("❌ ATXP Payment failure callback triggered:", payment, error);
      }
    });
    setAtxpImageClient(imageClient);
  }, [])

  useEffect(() => {
    if (atxpAccount) {
      createImageClient(atxpAccount);
    }
  }, [atxpAccount, createImageClient])

  const generateImage = useCallback(
    async ({
      prompt,
    }: {
      prompt: string;
    }): Promise<GeneratedResult> => {
      if (!prompt)
        return {
          isError: true,
          error: "Prompt is required",
        };

      if (!atxpImageClient) {
        console.error("Failed to load ATXP account");
        return {
          isError: true,
          error: "Failed to load ATXP account",
        };
      }

      try {
        const response = await atxpImageClient.callTool({
          name: IMAGE_SERVICE.createImageAsyncToolName,
          arguments: IMAGE_SERVICE.getArguments(prompt),
        });

        const finalResult = IMAGE_SERVICE.getAsyncCreateResult(response as {content: [{text: string}]});

        return {
          isError: false,
          taskId: finalResult.taskId,
        };
      } catch (error) {
        console.error("🔥 MCP request failed:", error);

        // Check if this is a payment verification failure (transaction succeeded but receipt not found)
        if (error instanceof Error && error.message.includes('Transaction receipt')) {
          console.log("💳 Payment verification failed - transaction may still be propagating");
          return {
            isError: true,
            error: `💳 Payment verification failed - your transaction may still be propagating on the World Chain network.\n\n` +
                   `Your USDC transaction likely succeeded, but the payment server couldn't verify it yet due to network delays.\n\n` +
                   `Please wait 1-2 minutes and try again. If the transaction succeeded, you should not be charged again.`,
          };
        }

        return {
          isError: true,
          error: `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
    [atxpImageClient],
  );


  const waitForImage = useCallback(
    async ({ taskId }: { taskId: string }) => {
      if (!taskId) return null;

      if (!atxpImageClient) {
        console.error("Failed to load ATXP account");
        return null;
      }

      console.log("🛠️ Starting client-side polling for task completion...");

      // Client-side polling logic - poll every 5 seconds for up to 10 minutes
      const maxAttempts = 120; // 10 minutes / 5 seconds = 120 attempts
      const pollInterval = 5000; // 5 seconds

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {

          const response = await atxpImageClient.callTool({
            name: IMAGE_SERVICE.getImageAsyncToolName,
            arguments: { taskId }, // Only send taskId, no timeout parameter
            // Remove timeout option entirely - let MCP client use its default
          });

          const result = IMAGE_SERVICE.getAsyncStatusResult(response as {content: [{text: string}]});

          if (result.status === "completed" || result.status === "success") {
            console.log("✅ Image generation completed successfully!");
            return result.url;
          } else if (result.status === "error") {
            console.error("❌ Image generation failed:", result.error);
            return null;
          } else {
            // Still processing, wait before next attempt
            console.log(`⏳ Image still processing (${result.status}), waiting ${pollInterval}ms...`);
            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
          }
        } catch (error) {
          console.error(`🔥 MCP status polling failed on attempt ${attempt}:`, error);
          // If it's a connection error, clear the client to force reconnection
          // Wait before retrying
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }
      }

      console.error("⏰ Polling timeout: Image generation did not complete within 10 minutes");
      return null;
    },
    [atxpImageClient],
  );


  return (
    <AtxpContext.Provider
      value={{
        atxpAccount,
        generateImage,
        waitForImage,
      }}>
      {children}
    </AtxpContext.Provider>
  );
};

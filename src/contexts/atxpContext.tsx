"use client";

import { WorldAppAccount } from "@atxp/worldcoin";
import { atxpClient } from "@atxp/client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import ky from "ky";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { EIP1193Provider, parseUnits } from "viem";
import { useAccount, useConnectorClient } from "wagmi";
import { useSession } from "next-auth/react";
import {
  GeneratedResult,
} from "@/types/ai.type";
import { ConsoleLogger, LogLevel, paymentRequiredError, parsePaymentRequests } from "@atxp/common";
import { MiniKit } from "@worldcoin/minikit-js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface AtxpContextType {
  atxpAccount: WorldAppAccount | null;
  clearAtxp: () => void;
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
    timeoutSeconds: 300,
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
  const [atxpAccount, setAtxpAccount] = useState<WorldAppAccount | null>(null);
  const [atxpImageClient, setAtxpImageClient] = useState<Client | null>(null);

  const { address } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { data: session } = useSession();

  const loadAtxp = useCallback(async () => {
    // Try to get wallet address from wagmi first, then from session
    const walletAddress = address || session?.user?.walletAddress;

    if (!walletAddress) {
      return null;
    }

    // If no connector client from wagmi, create a simple MiniKit provider
    let provider: EIP1193Provider | undefined = connectorClient;
    if (!provider) {
      // Create a minimal MiniKit-compatible provider
      provider = {
        request: async ({ method, params }: { method: string; params: string[] }) => {
          switch (method) {
            case 'eth_accounts':
              return [walletAddress];
            case 'eth_chainId':
              return '0x1e0'; // Worldchain chain ID (480)
            case 'eth_requestAccounts':
              return [walletAddress];
            case 'personal_sign':
              const [message] = params;
              const signResult = await MiniKit.commandsAsync.signMessage({ message });
              if (signResult?.finalPayload?.status === 'success') {
                return signResult.finalPayload.signature;
              }
              throw new Error(`MiniKit signing failed: ${signResult?.finalPayload?.error_code}`);
            default:
              throw new Error(`Method ${method} not supported in MiniKit context`);
          }
        },
        isConnected: () => true,
        chainId: 480,
        selectedAddress: walletAddress,
      };
    }

    const tmpAtxpAccount = await WorldAppAccount.initialize({
      walletAddress,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider, // Type cast needed for client compatibility
      allowance: parseUnits("10", 6), // 10 USDC
      useEphemeralWallet: false, // Regular wallet mode (smart wallet infrastructure not available on World Chain)
      periodInDays: 30,
    });

    setAtxpAccount(tmpAtxpAccount);
    return tmpAtxpAccount;
  }, [address, connectorClient, session?.user?.walletAddress]);

  // Auto-initialize ATXP account when we get an address (wagmi or session)
  useEffect(() => {
    const walletAddress = address || session?.user?.walletAddress;

    if (walletAddress && !atxpAccount) {
      console.log("Triggering ATXP account initialization - walletAddress:", walletAddress);
      loadAtxp();
    }
  }, [address, connectorClient, session?.user?.walletAddress, atxpAccount, loadAtxp]);

  const clearAtxp = useCallback(() => {
    if (!address) return;
    WorldAppAccount.clearAllStoredData(address);
    setAtxpAccount(null);
  }, [address]);

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
      let tmpAtxpAccount = atxpAccount;
      if (!tmpAtxpAccount) {
        tmpAtxpAccount = await loadAtxp();
      }
      if (!tmpAtxpAccount) {
        console.error("Failed to load ATXP account");
        return {
          isError: true,
          error: "Failed to load ATXP account",
        };
      }

      let imageClient = atxpImageClient;
      if (!imageClient) {
        // Try to generate a JWT manually before client creation for debugging
        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
          logger: new ConsoleLogger({ level: LogLevel.DEBUG }),
          onPayment: async ({ payment }) => {
            console.log("🎉 ATXP Payment callback triggered:", payment);
          },
          onPaymentFailure: async ({ payment, error }) => {
            console.log("❌ ATXP Payment failure callback triggered:", payment, error);
          }
        });

        console.log("🎯 ATXP client created successfully");
        setAtxpImageClient(imageClient);
      }

      console.log("🛠️ Making authenticated API call to ATXP backend...");
      const response = await imageClient.callTool({
        name: IMAGE_SERVICE.createImageAsyncToolName,
        arguments: IMAGE_SERVICE.getArguments(prompt),
      });

      console.log("📨 Backend response received:", {
        success: !!response,
        responseType: typeof response,
        note: "If this works, JWT verification succeeded on backend"
      });

      console.log("image gen async response", response);

      const finalResult = IMAGE_SERVICE.getAsyncCreateResult(response as {content: [{text: string}]});
      console.log("image gen final result", finalResult);

      return {
        isError: false,
        taskId: finalResult.taskId,
      };
    },
    [atxpAccount, atxpImageClient, loadAtxp],
  );


  const waitForImage = useCallback(
    async ({ taskId }: { taskId: string }) => {
      if (!taskId) return;
      let tmpAtxpAccount = atxpAccount;
      if (!tmpAtxpAccount) {
        tmpAtxpAccount = await loadAtxp();
      }
      if (!tmpAtxpAccount) {
        console.error("Failed to load ATXP account");
        return;
      }

      let imageClient = atxpImageClient;
      if (!imageClient) {
        console.log("🔐 Creating ATXP client for image status polling JWT transmission...");

        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
        });
        setAtxpImageClient(imageClient);

        console.log("🎯 ATXP client for polling created successfully");
      }

      console.log("🛠️ Making authenticated status polling API call...");
      const response = await imageClient.callTool({
        name: IMAGE_SERVICE.getImageAsyncToolName,
        arguments: IMAGE_SERVICE.getWaitForImageArguments(taskId),
      });
      console.log("image wait for response", response);
      const finalResult = IMAGE_SERVICE.getAsyncStatusResult(response as {content: [{text: string}]});
      console.log("image wait for final result", finalResult);

      if (
        finalResult.status === "completed" ||
        finalResult.status === "success"
      ) {
        return finalResult.url;
      } else {
        return null;  // TODO: handle error
      }
    },
    [atxpAccount, atxpImageClient, loadAtxp],
  );


  return (
    <AtxpContext.Provider
      value={{
        atxpAccount,
        clearAtxp,
        generateImage,
        waitForImage,
      }}>
      {children}
    </AtxpContext.Provider>
  );
};

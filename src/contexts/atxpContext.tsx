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
import { parseUnits } from "viem";
import { useAccount, useConnectorClient } from "wagmi";
import {
  GeneratedResult,
} from "@/types/ai.type";

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

  const loadAtxp = useCallback(async () => {
    if (!address) {
      return null;
    }
    try {
      if (!connectorClient) {
        throw new Error("No connector client available");
      }

      const tmpAtxpAccount = await WorldAppAccount.initialize({
        walletAddress: address,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: connectorClient as any, // Type cast needed for wagmi client compatibility
        allowance: parseUnits("10", 6), // 10 USD
        useEphemeralWallet: true,
        periodInDays: 30,
      });

      setAtxpAccount(tmpAtxpAccount);
      return tmpAtxpAccount;
    } catch (error) {
      console.error("Error setting up ATXP account", error);
      return null;
    }
  }, [address, connectorClient]);

  // Auto-initialize ATXP account when we get an address and connector client
  useEffect(() => {
    if (address && connectorClient && !atxpAccount) {
      loadAtxp();
    }
  }, [address, connectorClient, atxpAccount, loadAtxp]);

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
        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
        });
        setAtxpImageClient(imageClient);
      }

      const response = await imageClient.callTool({
        name: IMAGE_SERVICE.createImageAsyncToolName,
        arguments: IMAGE_SERVICE.getArguments(prompt),
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
        imageClient = await atxpClient({
          account: tmpAtxpAccount,
          mcpServer: IMAGE_SERVICE.mcpServer,
        });
        setAtxpImageClient(imageClient);
      }

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

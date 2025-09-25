"use client";

import { WorldchainAccount } from "@atxp/worldchain";
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
import { useAccount } from "wagmi";
import { useSession } from "next-auth/react";
import {
  GeneratedResult,
} from "@/types/ai.type";

import { MiniKit, SendTransactionInput } from "@worldcoin/minikit-js";
import { waitForTransactionConfirmation } from "@/lib/worldTransactionUtils";

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

const loadWorldchainAccount = async (walletAddress: string) => {
  // If no connector client from wagmi, create a simple MiniKit provider
  const provider = {
      request: async (args: { method: string; params: unknown[] }) => {
        const { method, params } = args;
        switch (method) {
          case 'eth_accounts':
            return [walletAddress];
          case 'eth_chainId':
            return '0x1e0'; // Worldchain chain ID (480)
          case 'eth_requestAccounts':
            return [walletAddress];
          case 'eth_sendTransaction':
            const transaction = params[0] as {data: string, to: string, value?: string, from: string};

            // Handle USDC transfer (ERC20 transfer function)
            if (transaction.data && transaction.data.startsWith('0xa9059cbb')) {
              // This is a transfer(address,uint256) call - decode the parameters
              const data = transaction.data.slice(10); // Remove function selector

              // Extract recipient address (first 32 bytes, last 20 bytes are the address)
              const recipientHex = '0x' + data.slice(24, 64);

              // Extract amount (next 32 bytes)
              const amountHex = '0x' + data.slice(64, 128);
              const amount = BigInt(amountHex).toString();

              // Validate transaction parameters
              console.log("[MiniKit] Decoded transaction parameters:", {
                contractAddress: transaction.to,
                recipient: recipientHex,
                amount: amount,
                amountInUSDC: (Number(amount) / 1000000).toString() + ' USDC',
                from: transaction.from
              });

              // Check for memo data (any data after the standard 128 characters)
              let memo = '';
              if (data.length > 128) {
                const memoHex = data.slice(128);
                try {
                  memo = Buffer.from(memoHex, 'hex').toString('utf8');
                  console.log(`[MiniKit] Extracted memo from transaction: "${memo}"`);
                } catch (e) {
                  console.warn('[MiniKit] Failed to decode memo data:', e);
                }
              }

              // ERC20 ABI for transfer function
              const ERC20_ABI = [
                {
                  inputs: [
                    { name: 'to', type: 'address' },
                    { name: 'amount', type: 'uint256' }
                  ],
                  name: 'transfer',
                  outputs: [{ name: '', type: 'bool' }],
                  stateMutability: 'nonpayable',
                  type: 'function'
                }
              ] as const;

              const input: SendTransactionInput = {
                transaction: [
                  {
                    address: transaction.to, // USDC contract address
                    abi: ERC20_ABI,
                    functionName: 'transfer',
                    args: [recipientHex, amount],
                    value: transaction.value || "0"
                  }
                ]
              };

              // Note: MiniKit doesn't have a standard way to include memo data in ERC20 transfers
              // The memo is extracted and logged but not included in the transaction
              if (memo) {
                console.log(`[MiniKit] Memo "${memo}" will be lost in MiniKit transaction - consider alternative approach`);
              }

              const sentResult = await MiniKit.commandsAsync.sendTransaction(input);

              if (sentResult.finalPayload?.status === 'success') {
                const transactionId = sentResult.finalPayload.transaction_id;

                // Wait for the transaction to be confirmed and get the actual transaction hash
                const confirmed = await waitForTransactionConfirmation(transactionId, 120000); // 2 minute timeout

                if (confirmed && confirmed.transactionHash) {
                  console.log(`[MiniKit] Transaction confirmed with hash: ${confirmed.transactionHash}`);
                  return confirmed.transactionHash; // Return the actual blockchain transaction hash
                } else {
                  console.error(`[MiniKit] Transaction confirmation failed for ID: ${transactionId}`);
                  throw new Error(`Transaction confirmation failed. Transaction may still be pending.`);
                }
              }

              // Enhanced error logging for debugging
              const errorCode = sentResult.finalPayload?.error_code;
              const simulationError = sentResult.finalPayload?.details?.simulationError;

              console.error("[MiniKit] Transaction failed:", {
                errorCode,
                simulationError,
                fullPayload: sentResult.finalPayload
              });

              // Provide more user-friendly error messages
              let userFriendlyError = `MiniKit sendTransaction failed: ${errorCode}`;

              if (simulationError?.includes('transfer amount exceeds balance')) {
                const amountUSDC = (Number(amount) / 1000000).toFixed(6);
                userFriendlyError = `💳 Insufficient USDC Balance\n\n` +
                  `You're trying to send ${amountUSDC} USDC, but your wallet doesn't have enough funds.\n\n` +
                  `To complete this payment:\n` +
                  `• Add USDC to your World App wallet\n` +
                  `• Bridge USDC from another chain\n` +
                  `• Buy USDC directly in World App\n\n` +
                  `Wallet: ${transaction.from?.slice(0, 6)}...${transaction.from?.slice(-4)}`;
              } else if (simulationError) {
                userFriendlyError += ` - ${simulationError}`;
              }


              throw new Error(userFriendlyError);
            }

            // Handle simple ETH transfers (no data or empty data)
            if (!transaction.data || transaction.data === '0x') {
              // For ETH transfers, you'd need to use the Forward contract
              throw new Error('ETH transfers require Forward contract - not implemented yet');
            }

            // For other transaction types
            throw new Error(`Unsupported transaction type. Data: ${transaction.data.slice(0, 10)}`);

          case 'personal_sign':
            const [message] = params;
            const signResult = await MiniKit.commandsAsync.signMessage({ message: message as string });
            if (signResult?.finalPayload?.status === 'success') {
              return signResult.finalPayload.signature;
            }
            throw new Error(`MiniKit signing failed: ${signResult?.finalPayload?.error_code}`);
          default:
            throw new Error(`Method ${method} not supported in MiniKit context`);
        }
      },
    };

  const worldchainAccount = await WorldchainAccount.initialize({
    walletAddress,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: provider as any, // Type cast needed for client compatibility
    allowance: parseUnits("10", 6), // 10 USDC
    useEphemeralWallet: false, // Regular wallet mode (smart wallet infrastructure not available on World Chain)
    periodInDays: 30,
    customRpcUrl: 'https://worldchain-mainnet.g.alchemy.com/v2/4Wxr8nWIrnKNvlM7pbbzB' // Your private RPC URL with API key
  });

  return worldchainAccount;
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
    const tmpAtxpAccount = await loadWorldchainAccount(walletAddress);

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

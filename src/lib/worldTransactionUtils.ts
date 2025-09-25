interface WorldTransaction {
  transactionId: string;
  transactionHash: string;
  transactionStatus: 'pending' | 'success' | 'failed';
  network: string;
  fromWalletAddress: string;
  toContractAddress: string;
}

/**
 * Resolves a MiniKit transaction ID to the actual blockchain transaction hash
 * using the World API
 */
export async function resolveTransactionHash(transactionId: string): Promise<{
  transactionHash: string;
  status: string;
} | null> {
  try {
    const response = await fetch('/api/resolve-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[WorldTransaction] API error: ${response.status} ${error}`);
      return null;
    }

    const transaction: WorldTransaction = await response.json();

    return {
      transactionHash: transaction.transactionHash,
      status: transaction.transactionStatus
    };

  } catch (error) {
    console.error('[WorldTransaction] Error resolving transaction:', error);
    return null;
  }
}

/**
 * Waits for a MiniKit transaction to be confirmed and returns the transaction hash
 * Polls the World API until the transaction is confirmed or times out
 */
export async function waitForTransactionConfirmation(
  transactionId: string,
  timeoutMs: number = 120000, // 2 minutes
  pollIntervalMs: number = 2000 // 2 seconds
): Promise<{
  transactionHash: string;
  status: string;
} | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await resolveTransactionHash(transactionId);

    if (result && result.transactionHash && result.status !== 'pending') {
      return result;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  console.warn(`[WorldTransaction] Timeout waiting for transaction confirmation: ${transactionId}`);
  return null;
}
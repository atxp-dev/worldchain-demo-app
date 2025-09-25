import { NextRequest, NextResponse } from 'next/server';

interface WorldTransaction {
  transactionId: string;
  transactionHash: string;
  transactionStatus: 'pending' | 'success' | 'failed';
  miniappId: string;
  updatedAt: string;
  network: string;
  fromWalletAddress: string;
  toContractAddress: string;
}

export async function POST(req: NextRequest) {
  try {
    const { transactionId } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { error: 'transactionId is required' },
        { status: 400 }
      );
    }

    if (!process.env.NEXT_PUBLIC_APP_ID) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_APP_ID not configured' },
        { status: 500 }
      );
    }

    // Call World API to get transaction hash
    const response = await fetch(
      `https://developer.worldcoin.org/api/v2/minikit/transaction/${transactionId}?app_id=${process.env.NEXT_PUBLIC_APP_ID}&type=transaction`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('World API error:', errorText);
      return NextResponse.json(
        { error: `World API error: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const transaction: WorldTransaction = await response.json();

    return NextResponse.json({
      transactionId: transaction.transactionId,
      transactionHash: transaction.transactionHash,
      transactionStatus: transaction.transactionStatus,
      network: transaction.network,
      fromWalletAddress: transaction.fromWalletAddress,
      toContractAddress: transaction.toContractAddress
    });

  } catch (error) {
    console.error('Error resolving transaction:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
import { CustodyAccount } from "@/lib/CustodyAccount";
import { PoolAccount } from "@/lib/PoolAccount";
import { TokenE } from "@/lib/Token";
import { Tab } from "@/lib/types";
import {
  getPerpetualProgramAndProvider,
  PERPETUALS_ADDRESS,
  TRANSFER_AUTHORITY,
} from "@/utils/constants";
import { manualSendTransaction } from "@/utils/manualTransaction";
import { checkIfAccountExists } from "@/utils/retrieveData";
import { BN } from "@project-serum/anchor";
import {
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SignerWalletAdapterProps } from "@solana/wallet-adapter-base";
import { Wallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export async function changeLiquidity(
  pool: PoolAccount,
  wallet: Wallet,
  publicKey: PublicKey,
  signTransaction: SignerWalletAdapterProps["signAllTransactions"],
  connection: Connection,
  custody: CustodyAccount,
  tokenAmount: number,
  liquidityAmount: number,
  tab: Tab
) {
  // @ts-ignore
  let { perpetual_program } = await getPerpetualProgramAndProvider(wallet);

  let lpTokenAccount = await getAssociatedTokenAddress(
    pool.getLpTokenMint(),
    publicKey
  );

  let userCustodyTokenAccount = await getAssociatedTokenAddress(
    custody.mint,
    publicKey
  );

  let transaction = new Transaction();

  try {
    if (!(await checkIfAccountExists(lpTokenAccount, connection))) {
      transaction = transaction.add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          lpTokenAccount,
          publicKey,
          pool.getLpTokenMint()
        )
      );
    }

    if (custody.getTokenE() == TokenE.SOL) {
      // assert tokenAmount is not 0

      console.log("pay token name is sol", custody.getTokenE());

      const associatedTokenAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        publicKey
      );

      if (!(await checkIfAccountExists(associatedTokenAccount, connection))) {
        console.log("sol ata does not exist", NATIVE_MINT.toString());

        transaction = transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            associatedTokenAccount,
            publicKey,
            NATIVE_MINT
          )
        );
      }

      // get balance of associated token account
      console.log("sol ata exists");
      const balance = await connection.getBalance(associatedTokenAccount);
      if (balance < tokenAmount! * LAMPORTS_PER_SOL) {
        console.log("balance insufficient");
        transaction = transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: associatedTokenAccount,
            lamports: tokenAmount! * LAMPORTS_PER_SOL,
          }),
          createSyncNativeInstruction(associatedTokenAccount)
        );
      }
    }

    console.log("custodies", pool.getCustodyMetas());
    if (tab == Tab.Add) {
      console.log("in add liq", tokenAmount);
      let amountIn;
      let minLpAmountOut = new BN(
        liquidityAmount * 10 ** pool.lpData.decimals * 0.8
      );
      if (custody.getTokenE() === TokenE.SOL) {
        amountIn = new BN(tokenAmount * LAMPORTS_PER_SOL);
      } else {
        amountIn = new BN(tokenAmount * 10 ** custody.decimals);
      }
      console.log("min lp out", Number(minLpAmountOut));
      let addLiquidityTx = await perpetual_program.methods
        .addLiquidity({ amountIn, minLpAmountOut })
        .accounts({
          owner: publicKey,
          fundingAccount: userCustodyTokenAccount, // user token account for custody token account
          lpTokenAccount,
          transferAuthority: TRANSFER_AUTHORITY,
          perpetuals: PERPETUALS_ADDRESS,
          pool: pool.address,
          custody: custody.address,
          custodyOracleAccount: custody.oracle.oracleAccount,
          custodyTokenAccount: custody.tokenAccount,
          lpTokenMint: pool.getLpTokenMint(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(pool.getCustodyMetas())
        .transaction();
      transaction = transaction.add(addLiquidityTx);
    } else if (tab == Tab.Remove) {
      console.log("in liq remove");
      let lpAmountIn = new BN(liquidityAmount * 10 ** pool.lpData.decimals);
      let minAmountOut;
      if (custody.getTokenE() === TokenE.SOL) {
        minAmountOut = new BN(tokenAmount * LAMPORTS_PER_SOL * 0.9);
      } else {
        minAmountOut = new BN(tokenAmount * 10 ** custody.decimals * 0.9);
      }
      let removeLiquidityTx = await perpetual_program.methods
        .removeLiquidity({ lpAmountIn, minAmountOut })
        .accounts({
          owner: publicKey,
          receivingAccount: userCustodyTokenAccount, // user token account for custody token account
          lpTokenAccount,
          transferAuthority: TRANSFER_AUTHORITY,
          perpetuals: PERPETUALS_ADDRESS,
          pool: pool.address,
          custody: custody.address,
          custodyOracleAccount: custody.oracle.oracleAccount,
          custodyTokenAccount: custody.tokenAccount,
          lpTokenMint: pool.getLpTokenMint(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(pool.getCustodyMetas())
        .transaction();
      transaction = transaction.add(removeLiquidityTx);
    }

    await manualSendTransaction(
      transaction,
      publicKey,
      connection,
      signTransaction
    );
  } catch (err) {
    console.log(err);
    throw err;
  }
}

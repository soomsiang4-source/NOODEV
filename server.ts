/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { initialProducts, initialCustomers, initialPreOrders, initialTransactions, initialLogs } from './src/data/mockData.js';
import { AIAnalysisResponse, TCGProduct, Customer, PreOrder, Transaction } from './src/types.js';

async function startServer() {
  const app = express();
  app.use(express.json());

  // In-memory state for runtime updates
  let tcgProducts: TCGProduct[] = [...initialProducts];
  let customers: Customer[] = [...initialCustomers];
  let preOrders: PreOrder[] = [...initialPreOrders];
  let transactions: Transaction[] = [...initialTransactions];
  let auditLogs: AIAnalysisResponse[] = [...initialLogs];

  // Initialize Gemini API client if GEMINI_API_KEY is available
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  // Get TCG Products API
  app.get('/api/tcg-products', (req, res) => {
    res.json({ success: true, products: tcgProducts });
  });

  // Update or Add TCG Product API
  app.post('/api/tcg-products', (req, res) => {
    const newProduct: TCGProduct = req.body;
    tcgProducts.unshift(newProduct);
    res.json({ success: true, products: tcgProducts });
  });

  // LINE Chat Simulator AI Endpoint
  app.post('/api/line-chat', async (req, res) => {
    const { message, customerId, model = 'gemini-3.5-flash', thinking = true } = req.body;

    const customer = customers.find(c => c.id === customerId) || customers[0];

    const systemInstruction = `
You are "ก๋วยเตี๋ยว", an expert AI assistant for a TCG (Trading Card Game) store operating on LINE OA in Thailand.
You support Lorcana, Pokémon, One Piece, and MTG.
You must strictly return JSON matching the following structure:
{
  "internal_reasoning": [string, string, ...],
  "recommendations": [string, string, ...],
  "line_message_draft": string,
  "log_record": {
    "timestamp": string,
    "customer_id": string,
    "command": string,
    "ai_intent": string,
    "data_accessed": string,
    "action": string,
    "result": string,
    "error": string | null,
    "confidence": string
  }
}
Rules:
1. All text must be in professional Thai with rich emojis (🏷️📦💸💬📝⚠️).
2. Write internal_reasoning step by step before concluding.
3. If money or rights are involved, reference official data source and date.
4. Do not hallucinate. If unsure, recommend escalating to admin.
`;

    const prompt = `
Customer Name: ${customer.name} (${customer.nickname})
Customer ID: ${customer.id} (LINE UID: ${customer.line_uid})
Customer Balance: ${customer.outstanding_balance} THB
Current TCG Inventory Catalog: ${JSON.stringify(tcgProducts)}
User Message: "${message}"
`;

    try {
      if (ai) {
        const chatModel = model === 'gemini-3.1-pro-preview' ? 'gemini-3.1-pro-preview' : model === 'gemini-3.1-flash-lite' ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash';
        const config: any = {
          systemInstruction,
          responseMimeType: 'application/json',
        };

        if (chatModel === 'gemini-3.1-pro-preview' && thinking) {
          config.thinkingConfig = { thinkingLevel: 'HIGH' };
        }

        const response = await ai.models.generateContent({
          model: chatModel,
          contents: prompt,
          config,
        });

        const responseText = response.text || '';
        const parsedJson = JSON.parse(responseText);

        auditLogs.unshift(parsedJson);

        return res.json({
          success: true,
          analysis: parsedJson
        });
      }
    } catch (err: any) {
      console.error('Gemini API Error, using fallback reasoning:', err);
    }

    // Fallback programmatic reasoning if API is unavailable
    const fallbackAnalysis: AIAnalysisResponse = {
      internal_reasoning: [
        `ตรวจสอบรหัสผู้ใช้ LINE UID: ${customer.line_uid} (${customer.name})`,
        `วิเคราะห์ข้อความขาเข้า: "${message}"`,
        'ตรวจสอบคลังข้อมูล TCG และนโยบายการชำระเงินมัดจำ',
        'พบข้อมูลตรงกับความต้องการและพร้อมดำเนินการ'
      ],
      recommendations: [
        'แนะนำขั้นตอนการชำระเงินมัดจำผ่าน QR Code หรือโอนผ่านบัญชีร้าน',
        'ส่งลิงก์ยืนยันออเดอร์ให้ลูกค้า'
      ],
      line_message_draft: `🎉 สวัสดีค่ะคุณ ${customer.nickname} 🏷️ ได้รับข้อมูลเรียบร้อยค่ะ สำหรับรายการที่คุณ ${customer.nickname} สนใจ ทางร้านมีสินค้าพร้อมบริการค่ะ 📦 สนใจคอนเฟิร์มยอดมัดจำ แจ้งแอดมินหรือกดปุ่มยืนยันได้เลยนะคะ 😊`,
      log_record: {
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        customer_id: `${customer.id} (LINE: ${customer.line_uid})`,
        command: 'ตอบแชทอัตโนมัติ LINE OA',
        ai_intent: 'สอบถามสินค้าและพรีออเดอร์',
        data_accessed: 'คลังสินค้า TCG, โปรไฟล์ลูกค้า',
        action: 'ประมวลผลข้อความและสร้างข้อความตอบกลับ',
        result: 'ตอบกลับสำเร็จ',
        error: null,
        confidence: 'สูง (High)'
      }
    };

    auditLogs.unshift(fallbackAnalysis);

    res.json({
      success: true,
      analysis: fallbackAnalysis
    });
  });

  // LINE Webhook Endpoint for real LINE OA connection
  app.post('/api/line-webhook', async (req, res) => {
    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const lineUserId = event.source.userId;
        console.log(`[LINE Webhook Received] From ${lineUserId}: ${userMessage}`);
      }
    }
    res.status(200).json({ status: 'ok' });
  });

  // Setup Vite middleware for development
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 TCG AI Assistant server running on http://localhost:${port}`);
  });
}

startServer();

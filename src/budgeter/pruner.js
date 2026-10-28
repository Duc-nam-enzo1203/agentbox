export class TokenBudgeter {
  /**
   * Fast, conservative BPE Token Estimator (~3.8 to 4 characters per token for English/code).
   */
  static estimateTokens(text) {
    if (!text || text.length === 0) return 0;
    const words = text.trim().split(/\s+/).length;
    const chars = text.length;
    return Math.ceil(Math.max(words * 1.3, chars / 3.7));
  }

  static estimateMessageTokens(message) {
    return this.estimateTokens(message.content) + 4;
  }

  static estimateTotalTokens(messages) {
    return messages.reduce((acc, msg) => acc + this.estimateMessageTokens(msg), 0);
  }

  /**
   * Prune messages according to budget options using the Priority Cascade Strategy
   */
  static prune(messages, options) {
    const originalTokens = this.estimateTotalTokens(messages);
    const targetBudget = options.maxContextTokens - options.reserveTokensForOutput;

    if (originalTokens <= targetBudget) {
      return {
        originalTokens,
        finalTokens: originalTokens,
        tokensSaved: 0,
        droppedMessagesCount: 0,
        messages,
      };
    }

    // Step 1: Protect System Message
    const systemMessages = [];
    const conversationMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    const systemTokens = this.estimateTotalTokens(systemMessages);
    let remainingBudget = targetBudget - systemTokens;

    if (remainingBudget <= 0) {
      return {
        originalTokens,
        finalTokens: systemTokens,
        tokensSaved: originalTokens - systemTokens,
        droppedMessagesCount: conversationMessages.length,
        messages: systemMessages,
      };
    }

    // Step 2: Compress bulky tool messages in historical turns
    const compressedMessages = conversationMessages.map((msg, idx) => {
      const isHistorical = idx < conversationMessages.length - 2;
      if (isHistorical && msg.role === 'tool' && msg.content && msg.content.length > 300) {
        const preview = msg.content.slice(0, 150);
        const tail = msg.content.slice(-100);
        const omittedBytes = msg.content.length - 250;
        return {
          ...msg,
          content: `${preview}\n... [AgentBox: Omitted ${omittedBytes} bytes of historical output] ...\n${tail}`,
        };
      }
      return msg;
    });

    let currentTokens = systemTokens + this.estimateTotalTokens(compressedMessages);
    if (currentTokens <= targetBudget) {
      return {
        originalTokens,
        finalTokens: currentTokens,
        tokensSaved: originalTokens - currentTokens,
        droppedMessagesCount: 0,
        messages: [...systemMessages, ...compressedMessages],
      };
    }

    // Step 3: Evict from oldest non-system messages forward, preserving the latest turns
    const preservedTail = [];
    let droppedCount = 0;

    for (let i = compressedMessages.length - 1; i >= 0; i--) {
      const msg = compressedMessages[i];
      const msgTokens = this.estimateMessageTokens(msg);

      if (remainingBudget >= msgTokens) {
        preservedTail.unshift(msg);
        remainingBudget -= msgTokens;
      } else {
        droppedCount++;
      }
    }

    const finalMessages = [...systemMessages];
    if (droppedCount > 0) {
      finalMessages.push({
        role: 'user',
        content: `[System Notice: ${droppedCount} earlier messages were pruned by AgentBox to stay within the ${options.maxContextTokens} token budget.]`,
      });
    }
    finalMessages.push(...preservedTail);

    const finalTokens = this.estimateTotalTokens(finalMessages);

    return {
      originalTokens,
      finalTokens,
      tokensSaved: originalTokens - finalTokens,
      droppedMessagesCount: droppedCount,
      messages: finalMessages,
    };
  }
}

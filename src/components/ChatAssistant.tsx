import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Bot } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';
import { chatWithAssistant } from '../services/geminiService';
import { translations } from '../i18n/translations';

const ChatAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { 
    chatHistory, 
    addChatMessage, 
    uiLang, 
    campaign,
    selectedPlaybookIds,
    currentStep
  } = useWorkflowStore();
  
  const t = translations[uiLang] as any;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [chatHistory, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage = input.trim();
    setInput('');
    addChatMessage({ role: 'user', content: userMessage });
    setIsLoading(true);

    try {
      const contextData = {
        currentStep,
        campaignTopic: campaign?.topic,
        executiveSummary: campaign?.synthesis?.executiveSummary,
        selectedPlaybookIds,
        probeCount: campaign?.probes.length,
      };
      
      const response = await chatWithAssistant(
        userMessage, 
        chatHistory, 
        contextData, 
        uiLang
      );
      
      addChatMessage({ role: 'assistant', content: response || '' });
    } catch (error) {
      console.error(error);
      addChatMessage({ role: 'assistant', content: "Sorry, I encountered an error answering your request." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[#03234b] text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-[#0a3d7a] transition-all z-50 animate-bounce"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 transition-all h-[500px] max-h-[80vh]">
          
          <div className="bg-[#03234b] text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#3cb4e6]" />
              <span className="font-bold text-sm tracking-wide">{t.chatTitle || "GEO Assistant"}</span>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-300 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {chatHistory.length === 0 && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-700 p-3 rounded-2xl rounded-tl-sm text-sm shadow-sm max-w-[85%]">
                  {t.chatInitial || "Hi! I am your GEO Assistant. How can I help you interpret the current insights?"}
                </div>
              </div>
            )}
            
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`p-3 rounded-2xl text-xs md:text-sm shadow-sm max-w-[85%] whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-[#03234b] text-white rounded-tr-sm' 
                      : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm prose prose-sm prose-slate'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-700 p-3 rounded-2xl rounded-tl-sm text-sm shadow-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#3cb4e6] animate-spin" /> Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-white border-t border-slate-100 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t.chatPlaceholder || "Type a message..."}
              className="flex-1 bg-slate-100 border-none rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3cb4e6]"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="bg-[#ffd200] text-[#03234b] p-2 rounded-full hover:bg-[#ffe24d] disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatAssistant;

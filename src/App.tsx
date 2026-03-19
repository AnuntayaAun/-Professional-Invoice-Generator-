/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useMemo, useRef, useEffect, ErrorInfo, ReactNode } from 'react';
import { Plus, Trash2, Download, Eye, Calculator, History, FileText, User, MapPin, Calendar, Hash, Save, Loader2, LogIn, LogOut, AlertCircle, ChevronRight, X, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Invoice, InvoiceItem } from './types';
import { auth, loginWithGoogle, logout, db, saveInvoiceToFirestore, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const VAT_RATE = 0.07;

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string;
}

// Error Boundary Component
class ErrorBoundary extends React.Component<any, any> {
  public state = { hasError: false, errorInfo: '' };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message || String(error) };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full space-y-4 border border-red-100">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle size={24} />
              <h2 className="text-xl font-bold">เกิดข้อผิดพลาด</h2>
            </div>
            <p className="text-gray-600 text-sm">ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง</p>
            <div className="bg-gray-50 p-3 rounded-lg text-xs font-mono text-gray-500 break-all">
              {this.state.errorInfo}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-2 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-all"
            >
              โหลดหน้าเว็บใหม่
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

function InvoiceApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${format(new Date(), 'yyyyMMdd')}-001`);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: '1', description: '', quantity: 1, pricePerUnit: 0 }
  ]);
  const [history, setHistory] = useState<Invoice[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const invoiceRef = useRef<HTMLDivElement>(null);
  const viewInvoiceRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!isAuthReady || !user) {
      setHistory([]);
      return;
    }

    const path = 'invoices';
    const q = query(
      collection(db, path),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invoices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
      setHistory(invoices);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0);
  }, [items]);

  const vat = useMemo(() => subtotal * VAT_RATE, [subtotal]);
  const total = useMemo(() => subtotal + vat, [subtotal, vat]);

  const addItem = () => {
    setItems([...items, { id: Math.random().toString(36).substr(2, 9), description: '', quantity: 1, pricePerUnit: 0 }]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleDownloadPDF = async (ref: React.RefObject<HTMLDivElement | null>, invNumber: string) => {
    if (!ref.current) return;

    setIsSaving(true);
    try {
      // Save to Firestore only if user is logged in and we're in 'create' mode
      if (user && activeTab === 'create' && !selectedInvoice) {
        const invoiceData = {
          customerName,
          customerAddress,
          date,
          invoiceNumber,
          items,
          subtotal,
          vat,
          total
        };
        await saveInvoiceToFirestore(invoiceData);
      }

      // Generate PDF
      const canvas = await html2canvas(ref.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => {
          const invoice = clonedDoc.querySelector('[data-invoice-container]') as HTMLElement;
          if (invoice) {
            // Remove all shadows and fix colors for all elements inside the invoice
            const allElements = invoice.querySelectorAll('*');
            allElements.forEach((el: any) => {
              const style = window.getComputedStyle(el);
              // Remove shadows which often use oklch in Tailwind 4
              if (style.boxShadow && style.boxShadow !== 'none') {
                el.style.boxShadow = 'none';
              }
              // Fix colors that might still be using oklch/oklab
              if (style.color.includes('oklch') || style.color.includes('oklab')) {
                el.style.color = '#000000';
              }
              if (style.backgroundColor.includes('oklch') || style.backgroundColor.includes('oklab')) {
                el.style.backgroundColor = 'transparent';
              }
              if (style.borderColor.includes('oklch') || style.borderColor.includes('oklab')) {
                el.style.borderColor = '#e5e7eb';
              }
            });
            
            // Fix main container
            invoice.style.boxShadow = 'none';
            invoice.style.border = '1px solid #e5e7eb';
            invoice.style.borderRadius = '0';
          }
        }
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`invoice-${invNumber || 'draft'}.pdf`);
    } catch (error) {
      console.error("Failed to save or download:", error);
      alert('เกิดข้อผิดพลาดในการสร้าง PDF กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <Loader2 className="animate-spin text-emerald-600" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-40 backdrop-blur-md bg-white/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div 
              whileHover={{ rotate: 5, scale: 1.05 }}
              className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-600/20"
            >
              <FileText size={22} />
            </motion.div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-black tracking-tight leading-none">InvoiceGen</h1>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Professional Billing</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-6">
            <nav className="flex gap-1 bg-zinc-100 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab('create')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all",
                  activeTab === 'create' ? "bg-white shadow-sm text-emerald-700" : "text-zinc-500 hover:text-zinc-900"
                )}
              >
                <div className="flex items-center gap-2">
                  <Plus size={14} className="sm:size-4" />
                  <span>สร้างบิล</span>
                </div>
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all",
                  activeTab === 'history' ? "bg-white shadow-sm text-emerald-700" : "text-zinc-500 hover:text-zinc-900"
                )}
              >
                <div className="flex items-center gap-2">
                  <History size={14} className="sm:size-4" />
                  <span>ประวัติ</span>
                </div>
              </button>
            </nav>

            <div className="h-8 w-px bg-zinc-200 hidden sm:block" />

            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden lg:block">
                  <p className="text-xs font-bold text-zinc-900 leading-none">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-400 font-medium">{user.email}</p>
                </div>
                {user.photoURL && (
                  <img src={user.photoURL} alt="Profile" className="w-9 h-9 rounded-xl border border-zinc-200 shadow-sm" />
                )}
                <button 
                  onClick={logout}
                  className="p-2 text-zinc-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                  title="ออกจากระบบ"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={loginWithGoogle}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-lg shadow-zinc-900/10"
              >
                <LogIn size={16} />
                <span className="hidden sm:inline">เข้าสู่ระบบ</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <AnimatePresence mode="wait">
          {!user && activeTab === 'create' && (
            <motion.div 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="mb-8 bg-emerald-50 border border-emerald-100 p-5 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-6"
            >
              <div className="flex items-center gap-4 text-emerald-900">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <p className="text-base font-bold">เข้าสู่ระบบเพื่อบันทึกประวัติ</p>
                  <p className="text-sm text-emerald-700/80">เก็บข้อมูลใบแจ้งหนี้ของคุณไว้บนคลาวด์ เข้าถึงได้จากทุกที่</p>
                </div>
              </div>
              <button 
                onClick={loginWithGoogle}
                className="w-full sm:w-auto px-8 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-black hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 transition-all active:scale-95 uppercase tracking-wider"
              >
                เข้าสู่ระบบทันที
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {activeTab === 'create' ? (
            <motion.div 
              key="create"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start"
            >
              {/* Form Section */}
              <section className="space-y-8">
                <div className="bg-white rounded-[2.5rem] shadow-sm border border-zinc-200 p-6 sm:p-10 space-y-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-black tracking-tight">ข้อมูลใบแจ้งหนี้</h2>
                      <p className="text-sm text-zinc-400 font-medium mt-1">ระบุรายละเอียดพื้นฐานของบิล</p>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 font-black text-xs">01</div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Hash size={14} className="text-emerald-500" /> เลขที่ใบแจ้งหนี้
                      </label>
                      <input 
                        type="text" 
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-zinc-900 placeholder:text-zinc-300"
                        placeholder="INV-2024-001"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Calendar size={14} className="text-emerald-500" /> วันที่
                      </label>
                      <input 
                        type="date" 
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-zinc-900"
                      />
                    </div>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-2">
                        <User size={14} className="text-emerald-500" /> ชื่อลูกค้า
                      </label>
                      <input 
                        type="text" 
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-zinc-900 placeholder:text-zinc-300"
                        placeholder="ชื่อ-นามสกุล หรือ ชื่อบริษัท"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-2">
                        <MapPin size={14} className="text-emerald-500" /> ที่อยู่ลูกค้า
                      </label>
                      <textarea 
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        rows={4}
                        className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all resize-none font-bold text-zinc-900 placeholder:text-zinc-300 leading-relaxed"
                        placeholder="ที่อยู่สำหรับออกใบกำกับภาษี"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-sm border border-zinc-200 p-6 sm:p-10 space-y-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-black tracking-tight">รายการสินค้า/บริการ</h2>
                      <p className="text-sm text-zinc-400 font-medium mt-1">เพิ่มรายการที่ต้องการเรียกเก็บเงิน</p>
                    </div>
                    <button 
                      onClick={addItem}
                      className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-black hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-600/20 uppercase tracking-wider"
                    >
                      <Plus size={16} />
                      <span>เพิ่มรายการ</span>
                    </button>
                  </div>

                  <div className="space-y-6">
                    <AnimatePresence initial={false}>
                      {items.map((item, index) => (
                        <motion.div 
                          key={item.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="group relative bg-zinc-50 p-6 rounded-[2rem] border border-transparent hover:border-emerald-500/20 hover:bg-emerald-50/20 transition-all"
                        >
                          <div className="grid grid-cols-12 gap-6 items-end">
                            <div className="col-span-12 lg:col-span-6 space-y-3">
                              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">รายละเอียด</label>
                              <input 
                                type="text" 
                                value={item.description}
                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:border-emerald-500 text-sm font-bold text-zinc-900 shadow-sm"
                                placeholder="ชื่อสินค้าหรือบริการ"
                              />
                            </div>
                            <div className="col-span-4 lg:col-span-2 space-y-3">
                              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">จำนวน</label>
                              <input 
                                type="number" 
                                value={item.quantity}
                                onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:border-emerald-500 text-sm font-bold text-zinc-900 text-center shadow-sm"
                              />
                            </div>
                            <div className="col-span-5 lg:col-span-3 space-y-3">
                              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">ราคา/หน่วย</label>
                              <input 
                                type="number" 
                                value={item.pricePerUnit}
                                onChange={(e) => updateItem(item.id, 'pricePerUnit', parseFloat(e.target.value) || 0)}
                                className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:border-emerald-500 text-sm font-bold text-zinc-900 text-right shadow-sm"
                              />
                            </div>
                            <div className="col-span-3 lg:col-span-1 flex justify-end">
                              <button 
                                onClick={() => removeItem(item.id)}
                                className="p-3 text-zinc-300 hover:text-red-500 transition-colors rounded-2xl hover:bg-red-50 active:scale-90"
                              >
                                <Trash2 size={20} />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </section>

              {/* Preview Section */}
              <section className="space-y-8 lg:sticky lg:top-28">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2">
                  <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
                    <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-900">
                      <Eye size={20} />
                    </div>
                    ตัวอย่างใบแจ้งหนี้
                  </h2>
                  <button 
                    onClick={() => handleDownloadPDF(invoiceRef, invoiceNumber)}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-[1.5rem] font-black shadow-2xl shadow-emerald-600/30 hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm"
                  >
                    {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
                    <span>{isSaving ? 'กำลังบันทึก...' : 'ดาวน์โหลด PDF'}</span>
                  </button>
                </div>

                {/* Invoice Paper */}
                <div className="overflow-x-auto pb-12 -mx-4 px-4 sm:mx-0 sm:px-0">
                  <div 
                    ref={invoiceRef}
                    data-invoice-container
                    className="bg-white shadow-2xl rounded-[2rem] aspect-[1/1.414] w-full min-w-[600px] lg:min-w-0 p-10 sm:p-16 flex flex-col border border-zinc-100 overflow-hidden relative"
                  >
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/50 rounded-bl-[10rem] -mr-32 -mt-32" />
                    
                    <div className="flex justify-between items-start mb-16 relative z-10">
                      <div>
                        <h3 className="text-5xl font-black text-emerald-700 tracking-tighter mb-2 uppercase italic leading-none">Invoice</h3>
                        <p className="text-[10px] font-black text-zinc-400 tracking-[0.4em] uppercase">{invoiceNumber}</p>
                      </div>
                      <div className="text-right">
                        <h4 className="font-black text-xl text-zinc-900">บริษัท ของคุณ จำกัด</h4>
                        <p className="text-[11px] text-zinc-400 font-medium max-w-[220px] leading-relaxed ml-auto mt-2">
                          123 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-16 mb-16 relative z-10">
                      <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100">
                        <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-3">เรียกเก็บเงินจาก</p>
                        <h5 className="font-black text-lg text-zinc-900 mb-2">{customerName || 'ชื่อลูกค้า'}</h5>
                        <p className="text-xs text-zinc-500 whitespace-pre-line leading-relaxed font-medium">
                          {customerAddress || 'ที่อยู่ลูกค้า'}
                        </p>
                      </div>
                      <div className="text-right pt-6">
                        <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-3">วันที่ออกบิล</p>
                        <p className="text-lg font-black text-zinc-900">{format(new Date(date), 'dd MMMM yyyy')}</p>
                      </div>
                    </div>

                    <div className="flex-1 relative z-10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b-2 border-emerald-600/20 text-left">
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px]">รายละเอียด</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-center w-20">จำนวน</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-right w-32">ราคา/หน่วย</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-right w-32">รวมเงิน</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td className="py-5 font-bold text-zinc-700">{item.description || 'ไม่มีรายละเอียด'}</td>
                              <td className="py-5 text-center text-zinc-500 font-medium">{item.quantity}</td>
                              <td className="py-5 text-right text-zinc-500 font-medium">{item.pricePerUnit.toLocaleString()}</td>
                              <td className="py-5 text-right font-black text-zinc-900">{(item.quantity * item.pricePerUnit).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-16 pt-10 border-t border-zinc-100 flex justify-end relative z-10">
                      <div className="w-72 space-y-4">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-zinc-400 uppercase tracking-widest">Subtotal</span>
                          <span className="text-zinc-700">{subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-zinc-400 uppercase tracking-widest">VAT (7%)</span>
                          <span className="text-zinc-700">{vat.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-black pt-6 border-t-2 border-emerald-600/20">
                          <span className="text-emerald-700 uppercase italic tracking-tighter">Total</span>
                          <span className="text-zinc-900">{total.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto pt-16 text-center relative z-10">
                      <p className="text-[10px] text-zinc-300 uppercase font-black tracking-[0.5em]">Thank you for your business</p>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          ) : (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-10"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div>
                  <h2 className="text-4xl font-black tracking-tight italic uppercase text-zinc-900">History</h2>
                  <p className="text-sm text-zinc-400 font-bold mt-1 uppercase tracking-widest">ทั้งหมด {history.length} รายการที่บันทึกไว้</p>
                </div>
              </div>

              {!user ? (
                <div className="bg-white rounded-[3rem] border-2 border-dashed border-zinc-100 p-12 sm:p-24 flex flex-col items-center justify-center text-center space-y-8">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[2rem] flex items-center justify-center text-zinc-300 shadow-inner">
                    <LogIn size={48} />
                  </div>
                  <div className="max-w-xs">
                    <h3 className="text-2xl font-black tracking-tight">กรุณาเข้าสู่ระบบ</h3>
                    <p className="text-sm text-zinc-400 mt-3 font-medium leading-relaxed">ประวัติการออกบิลของคุณจะถูกเก็บไว้อย่างปลอดภัยในระบบคลาวด์</p>
                  </div>
                  <button 
                    onClick={loginWithGoogle}
                    className="px-10 py-4 bg-zinc-900 text-white rounded-2xl font-black hover:bg-zinc-800 transition-all active:scale-95 shadow-2xl shadow-zinc-900/20 uppercase tracking-widest text-xs"
                  >
                    เข้าสู่ระบบด้วย Google
                  </button>
                </div>
              ) : history.length === 0 ? (
                <div className="bg-white rounded-[3rem] border-2 border-dashed border-zinc-100 p-12 sm:p-24 flex flex-col items-center justify-center text-center space-y-8">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[2rem] flex items-center justify-center text-zinc-300 shadow-inner">
                    <History size={48} />
                  </div>
                  <div className="max-w-xs">
                    <h3 className="text-2xl font-black tracking-tight">ยังไม่มีประวัติการออกบิล</h3>
                    <p className="text-sm text-zinc-400 mt-3 font-medium leading-relaxed">เริ่มสร้างใบแจ้งหนี้ใบแรกของคุณและบันทึกไว้ที่นี่</p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('create')}
                    className="px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-700 transition-all active:scale-95 shadow-2xl shadow-emerald-600/20 uppercase tracking-widest text-xs"
                  >
                    สร้างใบแจ้งหนี้ใหม่
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {history.map((inv, idx) => (
                    <motion.div 
                      key={inv.id} 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      onClick={() => setSelectedInvoice(inv)}
                      className="bg-white rounded-[2.5rem] border border-zinc-200 p-8 space-y-6 hover:shadow-2xl hover:shadow-zinc-900/5 transition-all group cursor-pointer relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-[4rem] -mr-16 -mt-16 group-hover:bg-emerald-100 transition-colors" />
                      
                      <div className="flex justify-between items-start relative z-10">
                        <div>
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em] mb-2">{inv.invoiceNumber}</p>
                          <h3 className="font-black text-xl text-zinc-900 group-hover:text-emerald-700 transition-colors line-clamp-1">{inv.customerName}</h3>
                        </div>
                        <div className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-tighter">Saved</div>
                      </div>
                      
                      <div className="flex justify-between items-end pt-6 border-t border-zinc-50 relative z-10">
                        <div className="space-y-1.5">
                          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">วันที่ออกบิล</p>
                          <p className="text-sm font-bold text-zinc-600">{format(new Date(inv.date), 'dd MMM yyyy')}</p>
                        </div>
                        <div className="text-right space-y-1.5">
                          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">ยอดรวมสุทธิ</p>
                          <p className="text-2xl font-black text-emerald-700 tracking-tighter leading-none">{inv.total.toLocaleString()} ฿</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-emerald-600 text-[10px] font-black uppercase tracking-[0.2em] opacity-0 group-hover:opacity-100 transition-all transform translate-x-[-10px] group-hover:translate-x-0 pt-2">
                        <span>ดูรายละเอียด</span>
                        <ChevronRight size={14} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Invoice Detail Modal */}
      <AnimatePresence>
        {selectedInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedInvoice(null)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-4xl max-h-[90vh] rounded-[3rem] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 sm:p-8 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black tracking-tight">{selectedInvoice.invoiceNumber}</h3>
                    <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">{selectedInvoice.customerName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleDownloadPDF(viewInvoiceRef, selectedInvoice.invoiceNumber)}
                    disabled={isSaving}
                    className="p-3 bg-zinc-100 text-zinc-900 rounded-2xl hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50"
                    title="ดาวน์โหลด PDF"
                  >
                    {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
                  </button>
                  <button 
                    onClick={() => setSelectedInvoice(null)}
                    className="p-3 bg-zinc-100 text-zinc-900 rounded-2xl hover:bg-zinc-200 transition-all active:scale-95"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 sm:p-12 bg-zinc-50/50">
                <div className="max-w-3xl mx-auto">
                  <div 
                    ref={viewInvoiceRef}
                    data-invoice-container
                    className="bg-white shadow-xl rounded-[2rem] aspect-[1/1.414] w-full p-10 sm:p-16 flex flex-col border border-zinc-100 overflow-hidden relative"
                  >
                    {/* Re-use the same invoice layout as in the preview */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/50 rounded-bl-[10rem] -mr-32 -mt-32" />
                    
                    <div className="flex justify-between items-start mb-16 relative z-10">
                      <div>
                        <h3 className="text-5xl font-black text-emerald-700 tracking-tighter mb-2 uppercase italic leading-none">Invoice</h3>
                        <p className="text-[10px] font-black text-zinc-400 tracking-[0.4em] uppercase">{selectedInvoice.invoiceNumber}</p>
                      </div>
                      <div className="text-right">
                        <h4 className="font-black text-xl text-zinc-900">บริษัท ของคุณ จำกัด</h4>
                        <p className="text-[11px] text-zinc-400 font-medium max-w-[220px] leading-relaxed ml-auto mt-2">
                          123 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-16 mb-16 relative z-10">
                      <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100">
                        <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-3">เรียกเก็บเงินจาก</p>
                        <h5 className="font-black text-lg text-zinc-900 mb-2">{selectedInvoice.customerName}</h5>
                        <p className="text-xs text-zinc-500 whitespace-pre-line leading-relaxed font-medium">
                          {selectedInvoice.customerAddress}
                        </p>
                      </div>
                      <div className="text-right pt-6">
                        <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-3">วันที่ออกบิล</p>
                        <p className="text-lg font-black text-zinc-900">{format(new Date(selectedInvoice.date), 'dd MMMM yyyy')}</p>
                      </div>
                    </div>

                    <div className="flex-1 relative z-10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b-2 border-emerald-600/20 text-left">
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px]">รายละเอียด</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-center w-20">จำนวน</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-right w-32">ราคา/หน่วย</th>
                            <th className="py-4 font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] text-right w-32">รวมเงิน</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {selectedInvoice.items.map((item) => (
                            <tr key={item.id}>
                              <td className="py-5 font-bold text-zinc-700">{item.description || 'ไม่มีรายละเอียด'}</td>
                              <td className="py-5 text-center text-zinc-500 font-medium">{item.quantity}</td>
                              <td className="py-5 text-right text-zinc-500 font-medium">{item.pricePerUnit.toLocaleString()}</td>
                              <td className="py-5 text-right font-black text-zinc-900">{(item.quantity * item.pricePerUnit).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-16 pt-10 border-t border-zinc-100 flex justify-end relative z-10">
                      <div className="w-72 space-y-4">
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-zinc-400 uppercase tracking-widest">Subtotal</span>
                          <span className="text-zinc-700">{selectedInvoice.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-zinc-400 uppercase tracking-widest">VAT (7%)</span>
                          <span className="text-zinc-700">{selectedInvoice.vat.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-black pt-6 border-t-2 border-emerald-600/20">
                          <span className="text-emerald-700 uppercase italic tracking-tighter">Total</span>
                          <span className="text-zinc-900">{selectedInvoice.total.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto pt-16 text-center relative z-10">
                      <p className="text-[10px] text-zinc-300 uppercase font-black tracking-[0.5em]">Thank you for your business</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <InvoiceApp />
    </ErrorBoundary>
  );
}

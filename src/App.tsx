/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useMemo, useRef, useEffect, ErrorInfo, ReactNode } from 'react';
import { Plus, Trash2, Download, Eye, Calculator, History, FileText, User, MapPin, Calendar, Hash, Save, Loader2, LogIn, LogOut, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Invoice, InvoiceItem } from './types';
import { auth, loginWithGoogle, logout, db, saveInvoiceToFirestore, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

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

  const invoiceRef = useRef<HTMLDivElement>(null);

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

  const handleDownloadPDF = async () => {
    if (!invoiceRef.current) return;

    setIsSaving(true);
    try {
      // Save to Firestore only if user is logged in
      if (user) {
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
      const canvas = await html2canvas(invoiceRef.current, {
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
          }
        }
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`invoice-${invoiceNumber || 'draft'}.pdf`);
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
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <FileText size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">InvoiceGen</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <nav className="flex gap-1 bg-black/5 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab('create')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  activeTab === 'create' ? "bg-white shadow-sm text-emerald-700" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <div className="flex items-center gap-2">
                  <Calculator size={16} />
                  <span>สร้างใบแจ้งหนี้</span>
                </div>
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  activeTab === 'history' ? "bg-white shadow-sm text-emerald-700" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <div className="flex items-center gap-2">
                  <History size={16} />
                  <span>ประวัติ</span>
                </div>
              </button>
            </nav>

            <div className="h-8 w-px bg-gray-100 mx-2" />

            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-gray-900 leading-none">{user.displayName}</p>
                  <p className="text-[10px] text-gray-400">{user.email}</p>
                </div>
                {user.photoURL && (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-black/5" />
                )}
                <button 
                  onClick={logout}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  title="ออกจากระบบ"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={loginWithGoogle}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-all"
              >
                <LogIn size={16} />
                <span>เข้าสู่ระบบ</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {!user && activeTab === 'create' && (
          <div className="mb-8 bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3 text-emerald-800">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">เข้าสู่ระบบเพื่อบันทึกประวัติการออกบิลแบบออนไลน์</p>
            </div>
            <button 
              onClick={loginWithGoogle}
              className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all"
            >
              เข้าสู่ระบบทันที
            </button>
          </div>
        )}

        {activeTab === 'create' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Form Section */}
            <section className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">ข้อมูลใบแจ้งหนี้</h2>
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-widest">Step 01</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      <Hash size={12} /> เลขที่ใบแจ้งหนี้
                    </label>
                    <input 
                      type="text" 
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="INV-2024-001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      <Calendar size={12} /> วันที่
                    </label>
                    <input 
                      type="date" 
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      <User size={12} /> ชื่อลูกค้า
                    </label>
                    <input 
                      type="text" 
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="ชื่อ-นามสกุล หรือ ชื่อบริษัท"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      <MapPin size={12} /> ที่อยู่ลูกค้า
                    </label>
                    <textarea 
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none"
                      placeholder="ที่อยู่สำหรับออกใบกำกับภาษี"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">รายการสินค้า/บริการ</h2>
                  <button 
                    onClick={addItem}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
                  >
                    <Plus size={16} />
                    <span>เพิ่มรายการ</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {items.map((item, index) => (
                    <div key={item.id} className="group relative grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-4 rounded-xl border border-transparent hover:border-black/5 transition-all">
                      <div className="col-span-12 md:col-span-6 space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">รายละเอียด</label>
                        <input 
                          type="text" 
                          value={item.description}
                          onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-black/5 rounded-lg focus:outline-none focus:border-emerald-500 text-sm"
                          placeholder="ชื่อสินค้าหรือบริการ"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">จำนวน</label>
                        <input 
                          type="number" 
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-white border border-black/5 rounded-lg focus:outline-none focus:border-emerald-500 text-sm text-center"
                        />
                      </div>
                      <div className="col-span-5 md:col-span-3 space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ราคา/หน่วย</label>
                        <input 
                          type="number" 
                          value={item.pricePerUnit}
                          onChange={(e) => updateItem(item.id, 'pricePerUnit', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-white border border-black/5 rounded-lg focus:outline-none focus:border-emerald-500 text-sm text-right"
                        />
                      </div>
                      <div className="col-span-3 md:col-span-1 flex justify-end">
                        <button 
                          onClick={() => removeItem(item.id)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Preview Section */}
            <section className="space-y-6 sticky top-24">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Eye size={20} className="text-emerald-600" />
                  ตัวอย่างใบแจ้งหนี้
                </h2>
                <div className="flex gap-2">
                  <button 
                    onClick={handleDownloadPDF}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                    <span>{isSaving ? 'กำลังบันทึก...' : 'ดาวน์โหลด PDF'}</span>
                  </button>
                </div>
              </div>

              {/* Invoice Paper */}
              <div 
                ref={invoiceRef}
                data-invoice-container
                className="bg-white shadow-2xl rounded-sm aspect-[1/1.414] w-full p-12 flex flex-col border border-black/5 overflow-hidden"
              >
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h3 className="text-3xl font-bold text-emerald-700 tracking-tighter mb-1 uppercase">Invoice</h3>
                    <p className="text-sm font-mono text-gray-400">{invoiceNumber}</p>
                  </div>
                  <div className="text-right">
                    <h4 className="font-bold text-lg">บริษัท ของคุณ จำกัด</h4>
                    <p className="text-xs text-gray-500 max-w-[200px] leading-relaxed">
                      123 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-12 mb-12">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">เรียกเก็บเงินจาก</p>
                    <h5 className="font-bold text-base mb-1">{customerName || 'ชื่อลูกค้า'}</h5>
                    <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed">
                      {customerAddress || 'ที่อยู่ลูกค้า'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">วันที่ออกบิล</p>
                    <p className="text-sm font-medium">{format(new Date(date), 'dd MMMM yyyy')}</p>
                  </div>
                </div>

                <div className="flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-emerald-600/10 text-left">
                        <th className="py-3 font-bold text-gray-400 uppercase tracking-widest text-[10px]">รายละเอียด</th>
                        <th className="py-3 font-bold text-gray-400 uppercase tracking-widest text-[10px] text-center w-20">จำนวน</th>
                        <th className="py-3 font-bold text-gray-400 uppercase tracking-widest text-[10px] text-right w-32">ราคา/หน่วย</th>
                        <th className="py-3 font-bold text-gray-400 uppercase tracking-widest text-[10px] text-right w-32">รวมเงิน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-4 font-medium text-gray-700">{item.description || 'ไม่มีรายละเอียด'}</td>
                          <td className="py-4 text-center text-gray-500">{item.quantity}</td>
                          <td className="py-4 text-right text-gray-500">{item.pricePerUnit.toLocaleString()}</td>
                          <td className="py-4 text-right font-semibold">{(item.quantity * item.pricePerUnit).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-12 pt-8 border-t border-gray-100 flex justify-end">
                  <div className="w-64 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">รวมเงิน (Subtotal)</span>
                      <span className="font-medium">{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                      <span className="font-medium">{vat.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold pt-3 border-t-2 border-emerald-600/10">
                      <span className="text-emerald-700">ยอดรวมสุทธิ</span>
                      <span>{total.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-12 text-center">
                  <p className="text-[10px] text-gray-300 uppercase tracking-[0.2em]">ขอบคุณที่ใช้บริการ</p>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">ประวัติการออกใบแจ้งหนี้</h2>
              <p className="text-sm text-gray-500">ทั้งหมด {history.length} รายการ</p>
            </div>

            {!user ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-20 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                  <LogIn size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">กรุณาเข้าสู่ระบบเพื่อดูประวัติ</h3>
                  <p className="text-sm text-gray-400">ประวัติการออกบิลของคุณจะถูกเก็บไว้อย่างปลอดภัยในระบบ</p>
                </div>
                <button 
                  onClick={loginWithGoogle}
                  className="px-6 py-2 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-all"
                >
                  เข้าสู่ระบบด้วย Google
                </button>
              </div>
            ) : history.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-20 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                  <History size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">ยังไม่มีประวัติการออกบิล</h3>
                  <p className="text-sm text-gray-400">เริ่มสร้างใบแจ้งหนี้ใบแรกของคุณได้เลย</p>
                </div>
                <button 
                  onClick={() => setActiveTab('create')}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-all"
                >
                  สร้างใบแจ้งหนี้ใหม่
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {history.map((inv) => (
                  <div key={inv.id} className="bg-white rounded-2xl border border-black/5 p-6 space-y-4 hover:shadow-xl hover:shadow-black/5 transition-all group">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{inv.invoiceNumber}</p>
                        <h3 className="font-bold text-lg group-hover:text-emerald-600 transition-colors">{inv.customerName}</h3>
                      </div>
                      <div className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold uppercase">Paid</div>
                    </div>
                    
                    <div className="flex justify-between items-end pt-4 border-t border-gray-50">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">วันที่</p>
                        <p className="text-xs font-medium">{format(new Date(inv.date), 'dd MMM yyyy')}</p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ยอดรวม</p>
                        <p className="text-base font-bold text-emerald-700">{inv.total.toLocaleString()} ฿</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
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

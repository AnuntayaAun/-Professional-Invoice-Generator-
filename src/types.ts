export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  pricePerUnit: number;
}

export interface Invoice {
  id: string;
  companyName?: string;
  companyAddress?: string;
  customerName: string;
  customerAddress: string;
  date: string;
  invoiceNumber: string;
  items: InvoiceItem[];
  subtotal: number;
  vat: number;
  total: number;
  createdAt: string;
}

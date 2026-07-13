import { useEffect, useState } from 'react';

import { Button, Card, Col, DatePicker, Row, Space, Statistic, Table, Tabs, message } from 'antd';

import { FileExcelOutlined } from '@ant-design/icons';

import dayjs, { Dayjs } from 'dayjs';

import { Link } from 'react-router-dom';

import { api, type ApiResult } from '../../api/client';

import { exportPlatformOverviewExcel } from '../../utils/exportExcel';
import { adminDefaultDateRange, lastNDaysToYesterday } from '../../utils/date-range.util';

import AdminMerchantAnalysis from './AdminMerchantAnalysis';

import './AdminMerchantAnalysis.css';



const { RangePicker } = DatePicker;



interface OverviewData {

  users: {

    total: number;

    active: number;

    newThisMonth: number;

    channelAccountCount: number;

    adSourceCount: number;

  };

  orders: {

    orderCount: number;

    totalCommission: number;

    pendingCommission: number;

    confirmedCommission: number;

    rejectedCommission: number;

  };

  ads: {

    totalAdSpend: number;

    impressions: number;

    clicks: number;

    overallRoi: number;

  };

  revenue: {

    totalCommission: number;

    totalAdSpend: number;

    profit: number;

  };

  byEmployee: Array<{

    userId: number;

    username: string;

    totalCommission: number;

    totalAdSpend: number;

    roi: number;

    profit: number;

    orderCount: number;

    rejectedCommission: number;

  }>;

}



function defaultRange(): [Dayjs, Dayjs] {
  return adminDefaultDateRange();
}



const DATE_PRESETS: Array<{ label: string; range: () => [Dayjs, Dayjs] }> = [

  { label: '今天', range: () => [dayjs(), dayjs()] },

  { label: '昨天', range: () => [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },

  { label: '近7天', range: () => lastNDaysToYesterday(7) },

  { label: '近30天', range: () => [dayjs().subtract(30, 'day'), dayjs().subtract(1, 'day')] },

  {

    label: '本月',

    range: () => [dayjs().startOf('month'), dayjs().subtract(1, 'day')],

  },

  {

    label: '上月',

    range: () => [

      dayjs().subtract(1, 'month').startOf('month'),

      dayjs().subtract(1, 'month').endOf('month'),

    ],

  },

];



export default function AdminStatsPage() {

  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);

  const [data, setData] = useState<OverviewData | null>(null);

  const [loading, setLoading] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const [activeTab, setActiveTab] = useState('overview');



  const startDate = range[0].format('YYYY-MM-DD');

  const endDate = range[1].format('YYYY-MM-DD');



  const loadOverview = async () => {

    setLoading(true);

    try {

      const { data: res } = await api.get<ApiResult<OverviewData>>('/admin/overview', {

        params: { startDate, endDate },

      });

      if (res.success) setData(res.data);

    } finally {

      setLoading(false);

    }

  };



  const handleQuery = () => {
    setRefreshKey((k) => k + 1);
    void loadOverview();
  };

  const handleExportOverview = () => {
    if (!data) {
      message.warning('请先查询数据');
      return;
    }
    exportPlatformOverviewExcel(data, startDate, endDate);
    message.success('平台统计已导出');
  };



  useEffect(() => {

    void loadOverview();

  }, []);



  return (

    <div>

      <Card title="平台统计">

        <Space wrap style={{ marginBottom: 16 }}>

          {DATE_PRESETS.map((p) => (

            <Button key={p.label} size="small" onClick={() => setRange(p.range())}>

              {p.label}

            </Button>

          ))}

        </Space>

        <div style={{ marginBottom: 16 }}>

          <RangePicker value={range} onChange={(v) => v && setRange(v as [Dayjs, Dayjs])} />

          <Button type="primary" style={{ marginLeft: 12 }} loading={loading && activeTab === 'overview'} onClick={handleQuery}>

            查询

          </Button>

          {activeTab === 'overview' && (
            <Button
              type="primary"
              className="merchant-export-btn"
              style={{ marginLeft: 12 }}
              icon={<FileExcelOutlined />}
              disabled={!data}
              onClick={handleExportOverview}
            >
              导出Excel
            </Button>
          )}

        </div>



        <Tabs

          activeKey={activeTab}

          onChange={setActiveTab}

          items={[

            {

              key: 'overview',

              label: '平台概览',

              children: (

                <div>

                  {loading && !data ? (

                    <div style={{ padding: 48, textAlign: 'center' }}>加载中...</div>

                  ) : data ? (

                    <>

                      <TypographySection title="用户" />

                      <Row gutter={16} style={{ marginBottom: 24 }}>

                        <Col span={6}><Statistic title="总用户" value={data.users.total} /></Col>

                        <Col span={6}><Statistic title="活跃员工" value={data.users.active} /></Col>

                        <Col span={6}><Statistic title="平台账号" value={data.users.channelAccountCount} /></Col>

                        <Col span={6}><Statistic title="广告 Sheet" value={data.users.adSourceCount} /></Col>

                      </Row>



                      <TypographySection title="订单" />

                      <Row gutter={16} style={{ marginBottom: 24 }}>

                        <Col span={6}><Statistic title="总订单" value={data.orders.orderCount} /></Col>

                        <Col span={6}>

                          <Statistic title="总佣金" prefix="$" value={data.orders.totalCommission} precision={2} />

                        </Col>

                        <Col span={6}>

                          <Statistic title="待确认" prefix="$" value={data.orders.pendingCommission} precision={2} />

                        </Col>

                        <Col span={6}>

                          <Statistic title="失效/拒绝" prefix="$" value={data.orders.rejectedCommission} precision={2} />

                        </Col>

                      </Row>



                      <TypographySection title="广告" />

                      <Row gutter={16} style={{ marginBottom: 24 }}>

                        <Col span={6}>

                          <Statistic title="总广告费" prefix="$" value={data.ads.totalAdSpend} precision={2} />

                        </Col>

                        <Col span={6}><Statistic title="展示" value={data.ads.impressions} /></Col>

                        <Col span={6}><Statistic title="点击" value={data.ads.clicks} /></Col>

                        <Col span={6}><Statistic title="整体 ROI" value={data.ads.overallRoi} precision={2} /></Col>

                      </Row>



                      <TypographySection title="收益分析" />

                      <Row gutter={16} style={{ marginBottom: 24 }}>

                        <Col span={8}>

                          <Statistic title="总佣金收入" prefix="$" value={data.revenue.totalCommission} precision={2} />

                        </Col>

                        <Col span={8}>

                          <Statistic title="总广告支出" prefix="$" value={data.revenue.totalAdSpend} precision={2} />

                        </Col>

                        <Col span={8}>

                          <Statistic

                            title="净利润"

                            prefix="$"

                            value={data.revenue.profit}

                            precision={2}

                            valueStyle={{ color: data.revenue.profit >= 0 ? '#16a34a' : '#dc2626' }}

                          />

                        </Col>

                      </Row>



                      <Table

                        title={() => '按员工对比'}

                        rowKey="userId"

                        dataSource={data.byEmployee}

                        pagination={false}

                        columns={[

                          { title: '员工', dataIndex: 'username' },

                          { title: '订单', dataIndex: 'orderCount', width: 80 },

                          {

                            title: '佣金',

                            dataIndex: 'totalCommission',

                            render: (v: number) => `$${v.toFixed(2)}`,

                          },

                          {

                            title: '广告费',

                            dataIndex: 'totalAdSpend',

                            render: (v: number) => `$${v.toFixed(2)}`,

                          },

                          {

                            title: '利润',

                            dataIndex: 'profit',

                            render: (v: number) => `$${v.toFixed(2)}`,

                          },

                          {

                            title: 'ROI',

                            dataIndex: 'roi',

                            render: (v: number) => (

                              <span style={{ color: v >= 0 ? '#16a34a' : '#dc2626' }}>{v.toFixed(2)}</span>

                            ),

                          },

                          {

                            title: '操作',

                            width: 120,

                            render: (_, r) => <Link to={`/admin/users/${r.userId}`}>查看</Link>,

                          },

                        ]}

                      />

                    </>

                  ) : null}

                </div>

              ),

            },

            {

              key: 'merchant',

              label: '商家分析',

              children: (

                <AdminMerchantAnalysis startDate={startDate} endDate={endDate} refreshKey={refreshKey} />

              ),

            },

          ]}

        />

      </Card>

    </div>

  );

}



function TypographySection({ title }: { title: string }) {

  return <h3 style={{ margin: '16px 0 12px', fontSize: 15, fontWeight: 600 }}>{title}</h3>;

}


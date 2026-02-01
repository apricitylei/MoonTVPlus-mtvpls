/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

// 服务器端内存缓存
const serverCache = {
  methodConfigs: new Map<string, { data: any; timestamp: number }>(),
  proxyRequests: new Map<string, { data: any; timestamp: number }>(),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24小时缓存
};

// 获取 TuneHub 配置
async function getTuneHubConfig() {
  const config = await getConfig();
  const siteConfig = config?.SiteConfig;

  const enabled = siteConfig?.TuneHubEnabled ?? false;
  const baseUrl =
    siteConfig?.TuneHubBaseUrl ||
    process.env.TUNEHUB_BASE_URL ||
    'https://tunehub.sayqz.com/api';
  const apiKey = siteConfig?.TuneHubApiKey || process.env.TUNEHUB_API_KEY || '';

  return { enabled, baseUrl, apiKey };
}

// 通用请求处理函数
async function proxyRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response;
  } catch (error) {
    console.error('TuneHub API 请求失败:', error);
    throw error;
  }
}

// 获取方法配置并执行请求
async function executeMethod(
  baseUrl: string,
  platform: string,
  func: string,
  variables: Record<string, string> = {}
): Promise<any> {
  // 1. 获取方法配置
  const cacheKey = `method-config-${platform}-${func}`;
  let config: any;

  const cached = serverCache.methodConfigs.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
    config = cached.data.data;
  } else {
    const response = await proxyRequest(`${baseUrl}/v1/methods/${platform}/${func}`);
    const data = await response.json();
    serverCache.methodConfigs.set(cacheKey, { data, timestamp: Date.now() });
    config = data.data;
  }

  if (!config) {
    throw new Error('无法获取方法配置');
  }

  // 2. 替换模板变量
  let url = config.url;
  const params: Record<string, string> = {};

  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      let processedValue = String(value);
      // 替换所有模板变量
      for (const [varName, varValue] of Object.entries(variables)) {
        processedValue = processedValue.replace(`{{${varName}}}`, varValue);
      }
      params[key] = processedValue;
    }
  }

  // 3. 构建完整 URL
  if (config.method === 'GET' && Object.keys(params).length > 0) {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      urlObj.searchParams.append(key, value);
    }
    url = urlObj.toString();
  }

  // 4. 发起请求
  const requestOptions: RequestInit = {
    method: config.method || 'GET',
    headers: config.headers || {},
  };

  if (config.method === 'POST' && config.body) {
    requestOptions.body = JSON.stringify(config.body);
    requestOptions.headers = {
      ...requestOptions.headers,
      'Content-Type': 'application/json',
    };
  }

  const response = await proxyRequest(url, requestOptions);
  let data = await response.json();

  // 5. 执行 transform 函数（如果有）
  if (config.transform) {
    try {
      // eslint-disable-next-line no-eval
      const transformFn = eval(`(${config.transform})`);
      data = transformFn(data);
    } catch (err) {
      console.error('Transform 函数执行失败:', err);
    }
  }

  return data;
}

// GET 请求处理
export async function GET(request: NextRequest) {
  try {
    const { enabled, baseUrl } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    // 处理不同的 action
    switch (action) {
      case 'toplists': {
        // 获取排行榜列表
        const platform = searchParams.get('platform');
        if (!platform) {
          return NextResponse.json(
            { error: '缺少 platform 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `toplists-${platform}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplists');
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'toplist': {
        // 获取排行榜详情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `toplist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'playlist': {
        // 获取歌单详情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `playlist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'playlist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'search': {
        // 搜索歌曲
        const platform = searchParams.get('platform');
        const keyword = searchParams.get('keyword');
        const page = searchParams.get('page') || '0';
        const pageSize = searchParams.get('pageSize') || '20';

        if (!platform || !keyword) {
          return NextResponse.json(
            { error: '缺少 platform 或 keyword 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `search-${platform}-${keyword}-${page}-${pageSize}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'search', {
          keyword,
          page,
          pageSize,
        });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// POST 请求处理（用于解析歌曲）
export async function POST(request: NextRequest) {
  try {
    const { enabled, baseUrl, apiKey } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'parse': {
        // 解析歌曲（需要 API Key）
        if (!apiKey) {
          return NextResponse.json(
            {
              code: -1,
              error: '未配置 TuneHub API Key',
              message: '未配置 TuneHub API Key'
            },
            { status: 403 }
          );
        }

        const { platform, ids, quality } = body;
        if (!platform || !ids) {
          return NextResponse.json(
            {
              code: -1,
              error: '缺少 platform 或 ids 参数',
              message: '缺少 platform 或 ids 参数'
            },
            { status: 400 }
          );
        }

        try {
          const response = await proxyRequest(`${baseUrl}/v1/parse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
            },
            body: JSON.stringify({
              platform,
              ids,
              quality: quality || '320k',
            }),
          });

          const data = await response.json();
          console.log('TuneHub 解析响应:', data);

          // 如果 TuneHub 返回错误，包装成统一格式
          if (!response.ok || data.code !== 0) {
            return NextResponse.json({
              code: data.code || -1,
              message: data.message || data.error || '解析失败',
              error: data.error || data.message || '解析失败',
            });
          }

          return NextResponse.json(data);
        } catch (error) {
          console.error('解析歌曲失败:', error);
          return NextResponse.json({
            code: -1,
            message: '解析请求失败',
            error: (error as Error).message,
          });
        }
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

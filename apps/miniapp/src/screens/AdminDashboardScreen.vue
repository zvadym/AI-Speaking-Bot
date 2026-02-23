<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="kicker">Internal</div>
      <h1>Admin dashboard</h1>
      <p class="sub">UTC charts. Date range is <strong>inclusive</strong> for both From and To dates.</p>
    </header>

    <section class="card">
      <div class="row">
        <label class="field">
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" />
        </label>

        <div class="actions">
          <button class="btn danger" type="button" :disabled="loading || feedbackLoading" @click="clearPassword">Clear</button>
        </div>
      </div>
      <p class="hint">
        Password is sent to admin endpoints as <code>X-Admin-Password</code>.
      </p>
    </section>

    <section class="tabs" role="tablist" aria-label="Admin sections">
      <button class="tab-btn" :class="{ active: activeTab === 'overview' }" type="button" role="tab" @click="activeTab = 'overview'">
        Overview
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'analytics' }" type="button" role="tab" @click="activeTab = 'analytics'">
        Analytics
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'users' }" type="button" role="tab" @click="activeTab = 'users'">
        Users
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'messaging' }" type="button" role="tab" @click="activeTab = 'messaging'">
        Messaging
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'feedback' }" type="button" role="tab" @click="activeTab = 'feedback'">
        Feedback
      </button>
    </section>

    <template v-if="activeTab === 'overview'">
      <section class="landing-hero">
        <div class="landing-hero-grid">
          <div class="landing-copy">
            <div class="landing-pill">
              <span class="landing-pill-dot" aria-hidden="true"></span>
              Real-time operations
              <span class="landing-pill-sep" aria-hidden="true">·</span>
              Analytics, users, messaging
            </div>
            <h2 class="landing-title">A modern admin cockpit for Language Bot</h2>
            <p class="landing-sub">
              Glass UI, fast filters, and charts with hover values — built for clarity.
            </p>

            <div class="landing-cta">
              <button class="btn primary" type="button" :disabled="!canFetch || loading" @click="refreshAnalytics">
                {{ loading ? 'Loading…' : 'Refresh analytics' }}
              </button>
              <button class="btn" type="button" @click="activeTab = 'analytics'">Open analytics</button>
              <button class="btn" type="button" @click="activeTab = 'users'">Browse users</button>
            </div>

            <div class="trust">
              <div class="trust-label">Trusted stack</div>
              <div class="trust-badges" role="list" aria-label="Trust badges">
                <span class="trust-badge" role="listitem">
                  <svg viewBox="0 0 24 24" class="trust-ic" aria-hidden="true">
                    <path
                      d="M12 2.5c3 2.6 5.8 3 8.5 3.6v6.8c0 5.3-3.8 8.7-8.5 8.7S3.5 18.2 3.5 12.9V6.1C6.2 5.5 9 5.1 12 2.5Z"
                      fill="currentColor"
                      opacity="0.22"
                    />
                    <path
                      d="M9.3 12.2l1.7 1.8 3.9-4.3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  Stripe Billing
                </span>
                <span class="trust-badge" role="listitem">
                  <svg viewBox="0 0 24 24" class="trust-ic" aria-hidden="true">
                    <path d="M7 4h10v16H7z" fill="currentColor" opacity="0.18" />
                    <path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                  Postgres
                </span>
                <span class="trust-badge" role="listitem">
                  <svg viewBox="0 0 24 24" class="trust-ic" aria-hidden="true">
                    <path
                      d="M21.3 6.8c-1.5 6.8-6.5 12-13.7 14.4-.6.2-1.2-.3-1.1-.9l.7-4.3c-2.3-.9-3.8-2.5-3.6-4.4.3-2.3 3-3.9 6.2-3.8.5 0 1 .1 1.5.2l.3-2.2c.1-.6.8-1 1.4-.7 2.1 1 5.4 1.5 8.3.5.7-.2 1.3.4 1.2 1.2Z"
                      fill="currentColor"
                      opacity="0.22"
                    />
                    <path
                      d="M10.7 12.3h2.6c.9 0 1.6-.7 1.6-1.6 0-.9-.7-1.6-1.6-1.6h-1.8"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  Telegram Mini App
                </span>
              </div>
            </div>
          </div>

          <div class="landing-viz">
            <div class="viz-card">
              <div class="viz-head">
                <div>
                  <div class="viz-kicker">Real-time</div>
                  <div class="viz-title">New users pulse</div>
                </div>
                <div class="viz-meta">
                  <span class="viz-badge" :class="{ live: Boolean(lastUpdated) }">{{ lastUpdated ? 'Live' : 'Preview' }}</span>
                  <span class="viz-stamp" v-if="lastUpdated">{{ lastUpdated }}</span>
                </div>
              </div>

              <div class="spark">
                <svg viewBox="0 0 320 140" width="320" height="140" role="img" aria-label="New users pulse">
                  <defs>
                    <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stop-color="rgba(59, 130, 246, 0.42)" />
                      <stop offset="1" stop-color="rgba(59, 130, 246, 0.06)" />
                    </linearGradient>
                    <linearGradient id="sparkLine" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0" stop-color="rgba(30, 64, 175, 0.9)" />
                      <stop offset="1" stop-color="rgba(245, 158, 11, 0.9)" />
                    </linearGradient>
                  </defs>
                  <path :d="spark.areaPath" fill="url(#sparkFill)" />
                  <path :d="spark.linePath" fill="none" stroke="url(#sparkLine)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                  <circle :cx="spark.lastPoint.x" :cy="spark.lastPoint.y" r="4.2" fill="rgba(245, 158, 11, 0.95)" />
                </svg>
                <div class="spark-axis">
                  <span>{{ spark.leftLabel }}</span>
                  <span class="spark-note" v-if="spark.isPreview">Demo</span>
                  <span>{{ spark.rightLabel }}</span>
                </div>
              </div>

              <div class="viz-foot">
                <div class="viz-metric">
                  <div class="viz-metric-label">Active users (range)</div>
                  <div class="viz-metric-value">{{ fmt(totals.active_users_in_range) }}</div>
                </div>
                <div class="viz-metric">
                  <div class="viz-metric-label">Pro (range)</div>
                  <div class="viz-metric-value">{{ fmt(totals.pro_users_in_range) }}</div>
                </div>
                <div class="viz-metric">
                  <div class="viz-metric-label">Users (range)</div>
                  <div class="viz-metric-value">{{ fmt(totals.total_users_in_range) }}</div>
                </div>
              </div>

              <p class="viz-hint" v-if="!password">
                Enter the admin password to load live data and unlock analytics.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-section">
        <header class="landing-section-head">
          <h3>Feature highlights</h3>
          <p>Designed for daily ops: fast scanning, zero guesswork.</p>
        </header>
        <div class="feature-grid">
          <article class="feature" v-for="f in overviewFeatures" :key="f.title">
            <div class="feature-ic" v-html="f.icon" aria-hidden="true"></div>
            <div class="feature-title">{{ f.title }}</div>
            <div class="feature-desc">{{ f.desc }}</div>
          </article>
        </div>
      </section>

      <section class="landing-section">
        <header class="landing-section-head">
          <h3>Pricing snapshot</h3>
          <p>Two tiers, Stripe-managed subscriptions, clean entitlements.</p>
        </header>
        <div class="pricing-grid">
          <article class="pricing">
            <div class="pricing-tier">Free</div>
            <div class="pricing-price">—</div>
            <div class="pricing-sub">Great for trying the bot.</div>
            <ul class="pricing-list">
              <li>Daily voice limit</li>
              <li>Core corrections & replies</li>
              <li>Upgrade anytime</li>
            </ul>
            <button class="btn" type="button" @click="activeTab = 'users'">View free users</button>
          </article>
          <article class="pricing featured">
            <div class="pricing-tier">
              Pro
              <span class="pricing-badge">Most used</span>
            </div>
            <div class="pricing-price">—</div>
            <div class="pricing-sub">For consistent practice and growth.</div>
            <ul class="pricing-list">
              <li>Higher limits</li>
              <li>Monthly / yearly billing</li>
              <li>Self-serve billing portal</li>
            </ul>
            <button class="btn primary" type="button" @click="activeTab = 'analytics'">Track Pro growth</button>
          </article>
        </div>
        <p class="landing-note">
          Prices are defined in Stripe and surfaced in the user-facing subscription screen.
        </p>
      </section>
    </template>

    <template v-else-if="activeTab === 'analytics'">
      <section class="card">
        <div class="row">
          <label class="field">
            <span>From (UTC)</span>
            <input v-model="fromDate" type="date" />
          </label>

          <label class="field">
            <span>To (UTC, inclusive)</span>
            <input v-model="toDate" type="date" />
          </label>

          <label class="field">
            <span>Quick range</span>
            <select v-model="rangePreset" @change="applyRangePreset(rangePreset)">
              <option value="last_30_days">Last 30 days</option>
              <option value="last_week">Last week</option>
              <option value="last_month">Last month</option>
            </select>
          </label>
        </div>

        <div class="row">
          <label class="field grow">
            <span>Acquisition payload</span>
            <input
              v-model="payload"
              type="text"
              inputmode="text"
              autocomplete="off"
              placeholder="(optional)"
              list="payloads"
            />
            <datalist id="payloads">
              <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
            </datalist>
          </label>

          <div class="actions">
            <button class="btn primary" type="button" :disabled="!canFetch || loading" @click="refreshAnalytics">
              {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
            <button class="btn" type="button" :disabled="loading" @click="applyRangePreset('last_week')">Last week</button>
            <button class="btn" type="button" :disabled="loading" @click="applyRangePreset('last_month')">Last month</button>
            <button class="btn" type="button" :disabled="loading" @click="resetRange">Last 30d</button>
          </div>
        </div>

        <p class="hint" v-if="!password">Enter password first to load analytics.</p>
        <p class="error" v-else-if="errorText">{{ errorText }}</p>
      </section>

      <section class="cards">
        <div class="stat">
          <div class="label">Users (range)</div>
          <div class="value value-pair">
            {{ fmt(totals.active_users_in_range) }}
            <span class="value-secondary">/ {{ fmt(totals.total_users_in_range) }}</span>
          </div>
          <div class="meta">All-time: {{ fmt(totals.active_users_all_time) }} / {{ fmt(totals.total_users_all_time) }}</div>
        </div>
        <div class="stat">
          <div class="label">Inactive users</div>
          <div class="value">{{ fmt(totals.inactive_users_all_time) }}</div>
          <div class="meta">Current users with failed Telegram delivery</div>
        </div>
        <div class="stat">
          <div class="label">Pro (range)</div>
          <div class="value">{{ fmt(totals.pro_users_in_range) }}</div>
          <div class="meta">All-time: {{ fmt(totals.pro_users_all_time) }}</div>
        </div>
      </section>

      <section class="card" v-if="botStats.length">
        <header class="bot-stats-head">
          <div class="kicker">Bot Statistics</div>
          <div class="sub">Per-bot user counts and activity metrics</div>
        </header>
        <div class="bot-table-wrap">
          <table class="bot-table">
            <thead>
              <tr>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('bot_key')">
                    Bot
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('bot_key') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('base_lang')">
                    Base
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('base_lang') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('target_lang')">
                    Target
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('target_lang') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_3_days')">
                    Active (3d)
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_3_days') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_7_days')">
                    Last 7d
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_7_days') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_30_days')">
                    Last 30d
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_30_days') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bot in sortedBotStats" :key="bot.bot_key">
                <td class="bot">
                  <div class="bot-key">{{ bot.bot_key }}</div>
                  <div class="bot-meta">{{ fmt(bot.total_users) }} users</div>
                </td>
                <td>{{ bot.base_lang || '—' }}</td>
                <td>{{ bot.target_lang || '—' }}</td>
                <td class="num">{{ fmt(bot.users_last_3_days) }}</td>
                <td class="num">{{ fmt(bot.users_last_7_days) }}</td>
                <td class="num">{{ fmt(bot.users_last_30_days) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="charts-grid">
        <AdminChart
          title="New users by day"
          kind="bar"
          x-labels="all"
          :data="newUsersSeries"
          :series="[{ key: 'count', label: 'New users', color: 'rgba(199, 90, 36, 0.86)' }]"
        />

        <AdminChart
          title="New paid users by day (first time)"
          subtitle="Pro activations by day"
          kind="bar"
          x-labels="all"
          :data="newPaidSeries"
          :series="[
            { key: 'pro', label: 'Pro', color: 'rgba(199, 90, 36, 0.88)' }
          ]"
        />

        <AdminChart
          title="Action events by day"
          subtitle="Tracked product actions (stacked)"
          kind="bar"
          x-labels="all"
          :data="actionEventsSeries"
          :series="actionSeriesConfig"
        />

        <AdminChart
          title="Action funnel totals"
          subtitle="Total events in selected range"
          kind="bar"
          x-labels="all"
          :data="actionTotalsSeries"
          :series="[{ key: 'count', label: 'Events', color: 'rgba(87, 60, 127, 0.86)' }]"
        />

        <AdminChart
          title="Active users by day"
          subtitle="Active = at least one voice usage event that day"
          kind="bar"
          x-labels="all"
          :data="activeUsersSeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(31, 107, 99, 0.86)' }]"
        />

        <AdminChart
          title="Active users by day by bot"
          subtitle="Active users split by bot (stacked)"
          kind="bar"
          x-labels="all"
          :data="activeUsersByBotSeries"
          :series="activeUsersByBotSeriesConfig"
        />

        <AdminChart
          title="Inactive users by day"
          subtitle="Users marked inactive from permanent Telegram delivery failures"
          kind="bar"
          x-labels="all"
          :data="inactiveUsersSeries"
          :series="[{ key: 'count', label: 'Inactive users', color: 'rgba(174, 43, 40, 0.86)' }]"
        />

        <AdminChart
          title="Voice usage seconds by day"
          kind="line"
          x-labels="all"
          :data="usageSecondsSeries"
          :series="[
            { key: 'in_seconds', label: 'In', color: 'rgba(31, 107, 99, 0.9)' },
            { key: 'out_seconds', label: 'Out', color: 'rgba(199, 90, 36, 0.9)' }
          ]"
        />

        <AdminChart
          title="Active users by hour"
          subtitle="UTC hour-of-day distribution for selected range"
          kind="bar"
          x-labels="all"
          :data="activeUsersByHourSeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(31, 107, 99, 0.86)' }]"
        />

        <AdminChart
          title="Active users by hour today"
          subtitle="UTC, today only"
          kind="bar"
          x-labels="all"
          :data="activeUsersByHourTodaySeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(199, 90, 36, 0.86)' }]"
        />
      </section>
    </template>

    <template v-else-if="activeTab === 'users'">
      <section class="card">
        <div class="row">
          <label class="field">
            <span>From (UTC)</span>
            <input v-model="fromDate" type="date" />
          </label>

          <label class="field">
            <span>To (UTC, inclusive)</span>
            <input v-model="toDate" type="date" />
          </label>

          <label class="field">
            <span>Quick range</span>
            <select v-model="rangePreset" @change="applyRangePreset(rangePreset)">
              <option value="last_30_days">Last 30 days</option>
              <option value="last_week">Last week</option>
              <option value="last_month">Last month</option>
            </select>
          </label>
        </div>

        <div class="row">
          <label class="field grow">
            <span>Acquisition payload</span>
            <input
              v-model="payload"
              type="text"
              inputmode="text"
              autocomplete="off"
              placeholder="(optional)"
              list="payloads"
            />
            <datalist id="payloads">
              <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
            </datalist>
          </label>

          <div class="actions">
            <button class="btn primary" type="button" :disabled="!canFetch || usersLoading" @click="refreshUsersPage({ resetOffset: true })">
              {{ usersLoading ? 'Loading…' : 'Refresh users' }}
            </button>
            <button class="btn" type="button" :disabled="usersLoading" @click="applyRangePreset('last_week')">Last week</button>
            <button class="btn" type="button" :disabled="usersLoading" @click="applyRangePreset('last_month')">Last month</button>
            <button class="btn" type="button" :disabled="usersLoading" @click="resetRange">Last 30d</button>
          </div>
        </div>

        <p class="hint" v-if="!password">Enter password first to load users.</p>
        <p class="error" v-else-if="usersError">{{ usersError }}</p>
      </section>

      <section class="card users-table-card">
        <div class="users-head">
          <div>
            <div class="kicker">Users</div>
            <h2>Users</h2>
          </div>
          <div class="users-meta">
            <span v-if="usersTotal">Showing {{ fmt(usersPageStart) }}–{{ fmt(usersPageEnd) }} of {{ fmt(usersTotal) }}</span>
            <span v-else>Total: 0</span>
            <label class="users-limit">
              <span>Rows</span>
              <select v-model.number="usersLimit" :disabled="usersLoading" @change="usersApplyLimit">
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
                <option :value="200">200</option>
              </select>
            </label>
          </div>
        </div>

        <p class="hint" v-if="usersLoading && !usersRows.length">Loading users…</p>

        <div class="users-table-wrap" v-if="usersRows.length">
          <table class="users-table">
            <thead>
              <tr>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('created_at')">
                    Created
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('created_at') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('chat_id')">
                    Chat ID
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('chat_id') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('username')">
                    Username
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('username') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('first_name')">
                    Name
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('first_name') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('bot_key')">
                    Bot
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('bot_key') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('effective_tier')">
                    Tier
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('effective_tier') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('is_active')">
                    Active
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('is_active') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('last_seen_at')">
                    Last seen
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('last_seen_at') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in usersRows" :key="row.chat_id">
                <td><time>{{ formatFeedbackTime(row.created_at) }}</time></td>
                <td><code>{{ row.chat_id }}</code></td>
                <td>{{ row.username ? `@${row.username}` : '—' }}</td>
                <td>{{ row.first_name || '—' }}</td>
                <td>{{ row.bot_key || '—' }}</td>
                <td>{{ displayTier(row.effective_tier) }}</td>
                <td>{{ row.is_active ? 'yes' : 'no' }}</td>
                <td>{{ row.last_seen_at ? formatFeedbackTime(row.last_seen_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint" v-else-if="!usersLoading">No users found for current filters.</p>

        <div class="feedback-pager">
          <button class="btn" type="button" :disabled="usersLoading || usersOffset <= 0" @click="usersPrevPage">
            Previous
          </button>
          <button class="btn" type="button" :disabled="usersLoading || !usersHasNext" @click="usersNextPage">
            Next
          </button>
        </div>
      </section>
    </template>

    <section class="card broadcast" v-else-if="activeTab === 'messaging'">
      <div class="broadcast-head">
        <div>
          <div class="kicker">Broadcast</div>
          <h2>Send message to filtered users</h2>
          <p class="sub compact">Preview count updates from filters before sending.</p>
        </div>
        <div class="broadcast-counter">
          <div class="counter-label">Will send to</div>
          <div class="counter-value">{{ fmt(broadcastPreview.count) }}</div>
          <div class="counter-meta" v-if="previewLoading">Updating…</div>
          <div class="counter-meta" v-else-if="previewError">Preview error</div>
          <div class="counter-meta" v-else-if="previewUpdatedAt">Updated: {{ previewUpdatedAt }}</div>
        </div>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Username contains</span>
          <input
            v-model.trim="broadcast.username"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="(optional)"
          />
        </label>

        <label class="field">
          <span>Last activity</span>
          <select v-model="broadcast.lastActivityMode">
            <option value="any">Any</option>
            <option value="active_within">Active within X days</option>
            <option value="inactive_for">Inactive for X+ days</option>
            <option value="never_active">Never active</option>
          </select>
        </label>

        <label class="field" v-if="broadcast.lastActivityMode !== 'any' && broadcast.lastActivityMode !== 'never_active'">
          <span>X days</span>
          <input v-model.number="broadcast.lastActivityDays" type="number" min="1" max="3650" />
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>Usage filter</span>
          <select v-model="broadcast.usageMode">
            <option value="any">Any</option>
            <option value="reached">Limit reached</option>
            <option value="percent_gte">Usage >= X%</option>
          </select>
        </label>

        <label class="field" v-if="broadcast.usageMode === 'percent_gte'">
          <span>X percent</span>
          <input v-model.number="broadcast.usagePercent" type="number" min="0" max="100" />
        </label>

        <div class="field grow">
          <span>Current plan</span>
          <div class="plan-pills">
            <label class="pill">
              <input v-model="broadcast.planFree" type="checkbox" />
              <span>Free</span>
            </label>
            <label class="pill">
              <input v-model="broadcast.planPro" type="checkbox" />
              <span>Pro</span>
            </label>
          </div>
        </div>
      </div>

      <div class="row" v-if="botStats.length">
        <div class="field grow">
          <span>Bot</span>
          <div class="plan-pills">
            <label class="pill" :class="{ active: !hasSelectedBots }">
              <input
                type="checkbox"
                :checked="!hasSelectedBots"
                @change="broadcast.botKeys = []"
              />
              <span>All bots</span>
            </label>
            <label class="pill" v-for="bot in botStats" :key="bot.bot_key" :class="{ active: broadcast.botKeys.includes(bot.bot_key) }">
              <input v-model="broadcast.botKeys" type="checkbox" :value="bot.bot_key" />
              <span>{{ bot.bot_key }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Message text</span>
          <textarea
            v-model="broadcast.messageText"
            rows="5"
            maxlength="4096"
            placeholder="Write the message that will be sent to each selected user..."
          />
          <small class="hint">HTML formatting is supported in broadcast messages.</small>
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>Confirm send</span>
          <input
            v-model.trim="broadcastConfirm"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="Type SEND"
          />
        </label>

        <div class="actions">
          <button class="btn" type="button" :disabled="!password || previewLoading" @click="refreshBroadcastPreview()">
            {{ previewLoading ? 'Preview…' : 'Refresh preview' }}
          </button>
          <button class="btn primary" type="button" :disabled="!canSendBroadcast || sendingBroadcast" @click="sendBroadcast">
            {{ sendingBroadcast ? 'Sending…' : `Send to ${fmt(broadcastPreview.count)}` }}
          </button>
        </div>
      </div>

      <p class="hint" v-if="!password">Enter admin password above to use broadcast.</p>
      <p class="hint" v-else-if="!hasAnySelectedPlan">Pick at least one plan.</p>
      <p class="error" v-else-if="previewError">{{ previewError }}</p>
      <p class="error" v-else-if="sendError">{{ sendError }}</p>
      <p class="hint" v-else-if="sendInfo">{{ sendInfo }}</p>

      <div class="preview-sample" v-if="broadcastPreview.sample.length">
        <div class="sample-title">Sample recipients</div>
        <ul>
          <li v-for="row in broadcastPreview.sample.slice(0, 8)" :key="`${row.chat_id}-${row.bot_key}`">
            <code>{{ row.chat_id }}</code>
            <span>{{ row.username ? `@${row.username}` : '(no username)' }}</span>
            <span class="bot-badge">{{ row.bot_key }}</span>
            <span>{{ displayTier(row.effective_tier) }}</span>
            <span>{{ formatLastActivity(row.last_activity_at) }}</span>
          </li>
        </ul>
      </div>

      <div class="campaign-state" v-if="campaignState">
        <div class="campaign-head">
          <strong>Campaign #{{ campaignState.id }}</strong>
          <span class="chip">{{ campaignState.status }}</span>
        </div>
        <div class="campaign-stats">
          <span>Total: {{ fmt(campaignState.total_recipients) }}</span>
          <span>Sent: {{ fmt(campaignState.sent_count) }}</span>
          <span>Failed: {{ fmt(campaignState.failed_count) }}</span>
          <span>Pending: {{ fmt(campaignState.pending_count) }}</span>
        </div>
        <p class="error" v-if="campaignState.error_text">{{ campaignState.error_text }}</p>
      </div>
    </section>

    <section class="card feedback" v-else>
      <div class="feedback-head">
        <div>
          <div class="kicker">Feedback inbox</div>
          <h2>User feedback</h2>
          <p class="sub compact">Text and voice feedback submitted with <code>/feedback</code>.</p>
        </div>
        <div class="feedback-count">Total: {{ fmt(feedbackTotal) }}</div>
      </div>

      <div class="row">
        <label class="field">
          <span>From (UTC)</span>
          <input v-model="feedbackFromDate" type="date" />
        </label>
        <label class="field">
          <span>To (UTC, inclusive)</span>
          <input v-model="feedbackToDate" type="date" />
        </label>
        <label class="field">
          <span>Kind</span>
          <select v-model="feedbackKind">
            <option value="any">Any</option>
            <option value="text">Text</option>
            <option value="voice">Voice</option>
          </select>
        </label>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Search</span>
          <input
            v-model.trim="feedbackSearch"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="username, name, chat id, or text"
          />
        </label>
        <div class="actions">
          <button class="btn primary" type="button" :disabled="!canFetchFeedback || feedbackLoading" @click="refreshFeedback({ resetOffset: true })">
            {{ feedbackLoading ? 'Loading…' : 'Refresh' }}
          </button>
          <button class="btn" type="button" :disabled="feedbackLoading" @click="resetFeedbackRange">Last 30d</button>
        </div>
      </div>

      <p class="hint" v-if="!password">Enter admin password above to load feedback.</p>
      <p class="error" v-else-if="feedbackError">{{ feedbackError }}</p>

      <div class="feedback-list" v-if="feedbackRows.length">
        <article class="feedback-item" v-for="row in feedbackRows" :key="row.id">
          <div class="feedback-item-head">
            <div class="feedback-meta">
              <span class="chip">{{ row.kind }}</span>
              <code>#{{ row.id }}</code>
              <code>{{ row.chat_id }}</code>
              <span>{{ row.username ? `@${row.username}` : (row.first_name || 'unknown user') }}</span>
            </div>
            <time>{{ formatFeedbackTime(row.created_at) }}</time>
          </div>
          <pre class="feedback-text">{{ feedbackBody(row) }}</pre>
          <p class="hint" v-if="row.kind === 'voice' && row.telegram_file_id">
            Voice file id: <code>{{ row.telegram_file_id }}</code>
          </p>
        </article>
      </div>

      <p class="hint" v-else-if="password && !feedbackLoading">No feedback found for current filters.</p>

      <div class="feedback-pager">
        <button class="btn" type="button" :disabled="feedbackLoading || feedbackOffset <= 0" @click="feedbackPrevPage">
          Previous
        </button>
        <button class="btn" type="button" :disabled="feedbackLoading || !feedbackHasNext" @click="feedbackNextPage">
          Next
        </button>
      </div>
    </section>

    <footer class="foot">
      <button class="link" type="button" @click="emit('navigate', '/', { replace: true })">← Back to app</button>
      <span v-if="activeTab === 'analytics' && lastUpdated" class="stamp">Updated: {{ lastUpdated }}</span>
      <span v-else-if="activeTab === 'feedback' && feedbackUpdatedAt" class="stamp">Updated: {{ feedbackUpdatedAt }}</span>
      <span v-else-if="activeTab === 'messaging' && previewUpdatedAt" class="stamp">Updated: {{ previewUpdatedAt }}</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiJson } from '../lib/api.js';
import AdminChart from '../components/AdminChart.vue';

const props = defineProps({
  apiBase: { type: String, required: true }
});

const emit = defineEmits(['navigate']);

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToYmdUtc(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultRange() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = todayUtc;
  const from = new Date(to.getTime() - 29 * DAY_MS);
  return { from: dateToYmdUtc(from), to: dateToYmdUtc(to) };
}

function parseYmdAsUtc(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toExclusiveBoundaryYmd(inclusiveYmd) {
  const d = parseYmdAsUtc(inclusiveYmd);
  if (!d) return inclusiveYmd;
  return dateToYmdUtc(new Date(d.getTime() + DAY_MS));
}

function rangeForPreset(preset) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset === 'last_week') {
    const day = todayUtc.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    const thisWeekStart = new Date(todayUtc.getTime() - daysFromMonday * DAY_MS);
    const prevWeekStart = new Date(thisWeekStart.getTime() - 7 * DAY_MS);
    const prevWeekEnd = new Date(thisWeekStart.getTime() - DAY_MS);
    return { from: dateToYmdUtc(prevWeekStart), to: dateToYmdUtc(prevWeekEnd) };
  }
  if (preset === 'last_month') {
    const thisMonthStart = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(thisMonthStart.getTime() - DAY_MS);
    return { from: dateToYmdUtc(prevMonthStart), to: dateToYmdUtc(prevMonthEnd) };
  }
  return defaultRange();
}

const password = ref('');
const ADMIN_TABS = ['overview', 'analytics', 'users', 'messaging', 'feedback'];
const activeTab = ref('overview');
const { from: defaultFrom, to: defaultTo } = defaultRange();
const fromDate = ref(defaultFrom);
const toDate = ref(defaultTo);
const rangePreset = ref('last_30_days');
const payload = ref('');
const payloadOptions = ref([]);
const feedbackFromDate = ref(defaultFrom);
const feedbackToDate = ref(defaultTo);
const feedbackKind = ref('any');
const feedbackSearch = ref('');
const feedbackRows = ref([]);
const feedbackTotal = ref(0);
const feedbackOffset = ref(0);
const feedbackLimit = 40;
const feedbackLoading = ref(false);
const feedbackError = ref('');
const feedbackUpdatedAt = ref('');

const loading = ref(false);
const errorText = ref('');
const lastUpdated = ref('');
const previewUpdatedAt = ref('');

const totals = ref({
  total_users_all_time: 0,
  active_users_all_time: 0,
  inactive_users_all_time: 0,
  pro_users_all_time: 0,
  total_users_in_range: 0,
  active_users_in_range: 0,
  inactive_users_in_range: 0,
  pro_users_in_range: 0
});

const botStats = ref([]);

const botSort = reactive({
  key: 'users_last_3_days',
  dir: 'desc' // 'asc' | 'desc'
});

const newUsersSeries = ref([]);
const newPaidSeries = ref([]);
const actionEventsSeries = ref([]);
const actionTotalsSeries = ref([]);
const activeUsersSeries = ref([]);
const activeUsersByBotSeries = ref([]);
const activeUsersByBotSeriesConfig = ref([]);
const inactiveUsersSeries = ref([]);
const usageSecondsSeries = ref([]);
const activeUsersByHourSeries = ref([]);
const activeUsersByHourTodaySeries = ref([]);
const actionSeriesConfig = [
  { key: 'start', label: 'start', color: 'rgba(31, 107, 99, 0.88)' },
  { key: 'profile_set_level', label: 'profile_set_level', color: 'rgba(199, 90, 36, 0.88)' },
  { key: 'first_voice_sent', label: 'first_voice_sent', color: 'rgba(46, 88, 142, 0.88)' },
  { key: 'first_answer_delivered', label: 'first_answer_delivered', color: 'rgba(103, 78, 167, 0.88)' },
  { key: 'paywall_shown', label: 'paywall_shown', color: 'rgba(174, 43, 40, 0.86)' },
  { key: 'purchase_success', label: 'purchase_success', color: 'rgba(117, 156, 56, 0.88)' },
  { key: 'day1_return', label: 'day1_return', color: 'rgba(33, 124, 146, 0.88)' }
];
const usersRows = ref([]);
const usersTotal = ref(0);
const usersOffset = ref(0);
const usersLimit = ref(50);
const usersLoading = ref(false);
const usersError = ref('');
const usersSort = reactive({
  key: 'created_at',
  dir: 'desc' // 'asc' | 'desc'
});

const usersPageStart = computed(() => (usersTotal.value ? usersOffset.value + 1 : 0));
const usersPageEnd = computed(() => Math.min(usersOffset.value + usersRows.value.length, usersTotal.value));

const overviewFeatures = [
  {
    title: 'Charts with hover values',
    desc: 'See exact values on hover. Tap to pin a tooltip on mobile.',
    icon: `
      <svg viewBox="0 0 24 24" class="ic">
        <path d="M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M6 15l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="10" cy="11" r="1.5" fill="currentColor" opacity="0.7"/>
        <circle cx="13" cy="14" r="1.5" fill="currentColor" opacity="0.7"/>
        <circle cx="18" cy="8" r="1.5" fill="currentColor" opacity="0.7"/>
      </svg>
    `
  },
  {
    title: 'Fast filtering, inclusive ranges',
    desc: 'UTC ranges are inclusive. Quick presets keep audits consistent.',
    icon: `
      <svg viewBox="0 0 24 24" class="ic">
        <path d="M5 6h14M8 12h8M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M4 6l5 6v6l6-3v-3l5-6" fill="currentColor" opacity="0.14"/>
      </svg>
    `
  },
  {
    title: 'Users + messaging in one place',
    desc: 'Segment audiences, preview counts, and send broadcasts safely.',
    icon: `
      <svg viewBox="0 0 24 24" class="ic">
        <path d="M7 11h10M7 15h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M6 3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H10l-4 3v-3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" fill="currentColor" opacity="0.14"/>
      </svg>
    `
  },
  {
    title: 'Secure by design',
    desc: 'Admin endpoints require a password header. No caching for sensitive views.',
    icon: `
      <svg viewBox="0 0 24 24" class="ic">
        <path d="M12 2.5c3 2.6 5.8 3 8.5 3.6v6.8c0 5.3-3.8 8.7-8.5 8.7S3.5 18.2 3.5 12.9V6.1C6.2 5.5 9 5.1 12 2.5Z" fill="currentColor" opacity="0.14"/>
        <path d="M9.2 12.1l1.7 1.8 3.9-4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `
  }
];

const spark = computed(() => {
  const w = 320;
  const h = 140;
  const padX = 14;
  const padT = 18;
  const padB = 28;
  const baseY = h - padB;
  const innerH = h - padT - padB;

  const src = Array.isArray(newUsersSeries.value) ? newUsersSeries.value : [];
  const liveRows = src.slice(-14);
  const liveValues = liveRows.map((r) => Number(r?.count ?? 0)).filter((v) => Number.isFinite(v));
  const hasLive = liveRows.length >= 2 && liveValues.some((v) => v > 0);

  const previewValues = [4, 7, 5, 9, 8, 11, 7, 12, 10, 13, 9, 15, 12, 16];
  const values = hasLive ? liveRows.map((r) => Math.max(0, Number(r?.count ?? 0) || 0)) : previewValues;
  const leftLabel = hasLive ? String(liveRows[0]?.day ?? '') : 'Preview';
  const rightLabel = hasLive ? String(liveRows[liveRows.length - 1]?.day ?? '') : 'Now';
  const max = Math.max(1, ...values);
  const n = values.length;
  const step = (w - 2 * padX) / Math.max(1, n - 1);

  const points = values.map((v, i) => {
    const x = padX + i * step;
    const t = Math.max(0, Math.min(1, v / max));
    const y = padT + (1 - t) * innerH;
    return { x, y };
  });

  const linePath = points.length
    ? `M ${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`
    : `M ${padX} ${baseY} L ${w - padX} ${baseY}`;

  const areaPath = points.length
    ? `M ${points[0].x.toFixed(2)} ${baseY.toFixed(2)} L ${points
        .map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' L ')} L ${points[points.length - 1].x.toFixed(2)} ${baseY.toFixed(2)} Z`
    : `M ${padX} ${baseY} L ${w - padX} ${baseY} Z`;

  const lastPoint = points[points.length - 1] || { x: w - padX, y: baseY };

  return {
    isPreview: !hasLive,
    leftLabel,
    rightLabel,
    linePath,
    areaPath,
    lastPoint
  };
});

function usersSortIndicator(key) {
  if (usersSort.key !== key) return '';
  return usersSort.dir === 'asc' ? '↑' : '↓';
}

function toggleUsersSort(key) {
  if (usersSort.key === key) {
    usersSort.dir = usersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    usersSort.key = key;
    usersSort.dir = key === 'created_at' || key === 'last_seen_at' ? 'desc' : 'asc';
  }
  usersOffset.value = 0;
  refreshUsersPage({ resetOffset: true });
}

function usersApplyLimit() {
  usersOffset.value = 0;
  refreshUsersPage({ resetOffset: true });
}
const previewLoading = ref(false);
const previewError = ref('');
const sendError = ref('');
const sendInfo = ref('');
const sendingBroadcast = ref(false);
const broadcastConfirm = ref('');
const campaignState = ref(null);
const broadcastPreview = reactive({
  count: 0,
  sample: []
});
const broadcast = reactive({
  username: '',
  planFree: true,
  planPro: true,
  lastActivityMode: 'any',
  lastActivityDays: 14,
  usageMode: 'any',
  usagePercent: 80,
  messageText: '',
  botKeys: []
});

let previewTimer = null;
let campaignPollTimer = null;

function parseBotKeyLangs(botKey) {
  const s = String(botKey || '').trim();
  if (!s) return { base_lang: '', target_lang: '' };
  const parts = s.split(/[-_]/g).filter(Boolean);
  if (parts.length >= 2) return { base_lang: parts[0], target_lang: parts[1] };
  return { base_lang: parts[0] || '', target_lang: '' };
}

function botSortIndicator(key) {
  if (botSort.key !== key) return '';
  return botSort.dir === 'asc' ? '↑' : '↓';
}

function toggleBotSort(key) {
  if (botSort.key === key) {
    botSort.dir = botSort.dir === 'asc' ? 'desc' : 'asc';
    return;
  }
  botSort.key = key;
  botSort.dir = key === 'bot_key' || key === 'base_lang' || key === 'target_lang' ? 'asc' : 'desc';
}

function safeNum(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cmp(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const botStatsTable = computed(() =>
  (Array.isArray(botStats.value) ? botStats.value : []).map((bot) => {
    const langs = parseBotKeyLangs(bot?.bot_key);
    return {
      ...bot,
      ...langs,
      total_users: safeNum(bot?.total_users),
      active_users: safeNum(bot?.active_users),
      users_last_3_days: safeNum(bot?.users_last_3_days),
      users_last_7_days: safeNum(bot?.users_last_7_days),
      users_last_30_days: safeNum(bot?.users_last_30_days)
    };
  })
);

const sortedBotStats = computed(() => {
  const rows = botStatsTable.value.slice();
  const dir = botSort.dir === 'asc' ? 1 : -1;
  const key = botSort.key;

  rows.sort((ra, rb) => {
    const a = ra?.[key];
    const b = rb?.[key];

    const isText = key === 'bot_key' || key === 'base_lang' || key === 'target_lang';
    if (isText) {
      const av = String(a || '');
      const bv = String(b || '');
      const primary = av.localeCompare(bv);
      if (primary) return primary * dir;
      return String(ra.bot_key || '').localeCompare(String(rb.bot_key || ''));
    }

    const primary = cmp(safeNum(a), safeNum(b));
    if (primary) return primary * dir;
    return String(ra.bot_key || '').localeCompare(String(rb.bot_key || ''));
  });

  return rows;
});

const canFetch = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate.value)) return false;
  return fromDate.value <= toDate.value;
});
const canFetchFeedback = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackFromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackToDate.value)) return false;
  return feedbackFromDate.value <= feedbackToDate.value;
});
const feedbackHasNext = computed(() => feedbackOffset.value + feedbackRows.value.length < feedbackTotal.value);
const usersHasNext = computed(() => usersOffset.value + usersRows.value.length < usersTotal.value);

function adminHeaders() {
  return { 'X-Admin-Password': password.value };
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function transformByBotData(rows) {
  // Transform rows like [{ day, bot_key, count }, ...] 
  // into [{ day, uk_en: count, uk_de: count }, ...]
  const byDay = {};
  const botsSet = new Set();
  
  for (const row of rows) {
    const day = row.day;
    const botKey = row.bot_key || 'unknown';
    const count = Number(row.count || 0);
    
    botsSet.add(botKey);
    
    if (!byDay[day]) {
      byDay[day] = { day };
    }
    
    // Convert bot-key to valid JS property key (replace '-' with '_')
    const safeKey = botKey.replace(/-/g, '_');
    byDay[day][safeKey] = count;
  }
  
  // Convert to array and sort by day
  const chartData = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  
  // Build series config dynamically
  const botColors = {
    'uk_en': 'rgba(31, 107, 99, 0.88)',    // Teal for English
    'uk_de': 'rgba(199, 90, 36, 0.88)',    // Orange for German
  };
  
  const seriesConfig = Array.from(botsSet)
    .sort()
    .map(botKey => {
      const safeKey = botKey.replace(/-/g, '_');
      return {
        key: safeKey,
        label: botKey,
        color: botColors[safeKey] || 'rgba(100, 100, 100, 0.85)'
      };
    });
  
  return { chartData, seriesConfig };
}

function query() {
  return {
    from: fromDate.value,
    to: toExclusiveBoundaryYmd(toDate.value),
    payload: payload.value.trim() ? payload.value.trim() : undefined
  };
}

function feedbackQuery() {
  return {
    from: feedbackFromDate.value,
    to: toExclusiveBoundaryYmd(feedbackToDate.value),
    kind: feedbackKind.value !== 'any' ? feedbackKind.value : undefined,
    search: feedbackSearch.value.trim() ? feedbackSearch.value.trim() : undefined,
    limit: feedbackLimit,
    offset: feedbackOffset.value
  };
}

function fmt(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function isoStampNow() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', 'Z');
}

function formatLastActivity(raw) {
  if (!raw) return 'never active';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatFeedbackTime(raw) {
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return 'unknown time';
  return d.toISOString().replace('T', ' ').replace('Z', 'Z');
}

function displayTier(rawTier) {
  const tier = (rawTier || '').toString().toLowerCase();
  if (tier === 'free') return 'free';
  if (tier === 'pro') return 'pro';
  return 'pro';
}

function actionLabel(rawAction) {
  return (rawAction || '')
    .toString()
    .trim()
    .replaceAll('_', ' ');
}

function feedbackBody(row) {
  const text = row?.kind === 'voice' ? (row?.transcript || '') : (row?.feedback_text || '');
  const cleaned = String(text || '').trim();
  return cleaned || '(empty)';
}

const selectedPlans = computed(() => {
  const plans = [];
  if (broadcast.planFree) plans.push('free');
  if (broadcast.planPro) plans.push('pro');
  return plans;
});

const hasAnySelectedPlan = computed(() => selectedPlans.value.length > 0);
const hasSelectedBots = computed(() => broadcast.botKeys.length > 0);

function broadcastFiltersPayload() {
  const filters = {};
  if (broadcast.username.trim()) filters.username = broadcast.username.trim();

  if (selectedPlans.value.length > 0 && selectedPlans.value.length < 2) {
    filters.plans = selectedPlans.value;
  }

  if (broadcast.lastActivityMode !== 'any') {
    filters.lastActivityMode = broadcast.lastActivityMode;
    if (broadcast.lastActivityMode !== 'never_active') {
      filters.lastActivityDays = clampInt(broadcast.lastActivityDays, 1, 3650, 14);
    }
  }

  if (broadcast.usageMode !== 'any') {
    filters.usageMode = broadcast.usageMode;
    if (broadcast.usageMode === 'percent_gte') {
      filters.usagePercent = clampNumber(broadcast.usagePercent, 0, 100, 80);
    }
  }

  if (broadcast.botKeys.length > 0) {
    filters.bots = Array.from(
      new Set(
        broadcast.botKeys
          .map((v) => (v ?? '').toString().trim().toLowerCase())
          .filter((v) => v.length > 0 && v.length <= 32)
      )
    );
  }

  return filters;
}

const canSendBroadcast = computed(() => {
  const message = broadcast.messageText.trim();
  if (!password.value) return false;
  if (!hasAnySelectedPlan.value) return false;
  if (!message) return false;
  if (message.length > 4096) return false;
  if (broadcastPreview.count <= 0) return false;
  if (broadcastConfirm.value.toUpperCase() !== 'SEND') return false;
  return true;
});

function stopCampaignPolling() {
  if (!campaignPollTimer) return;
  window.clearInterval(campaignPollTimer);
  campaignPollTimer = null;
}

async function loadCampaignStatus(campaignId) {
  if (!password.value) return;
  const headers = adminHeaders();
  const data = await apiJson(props.apiBase, `/admin/broadcasts/${campaignId}`, { headers });
  campaignState.value = data?.campaign || null;
  const status = campaignState.value?.status || '';
  if (status === 'completed' || status === 'failed') {
    stopCampaignPolling();
  }
}

function startCampaignPolling(campaignId) {
  stopCampaignPolling();
  campaignPollTimer = window.setInterval(() => {
    loadCampaignStatus(campaignId).catch((err) => {
      console.error(err);
      stopCampaignPolling();
    });
  }, 2000);
}

async function refreshBroadcastPreview({ silent = false } = {}) {
  if (!password.value) return;
  if (!hasAnySelectedPlan.value) {
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewError.value = '';
    return;
  }

  previewLoading.value = true;
  if (!silent) previewError.value = '';
  try {
    const headers = adminHeaders();
    const body = { filters: broadcastFiltersPayload() };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/preview', {
      method: 'POST',
      headers,
      body
    });
    const nextCount = Number(data?.count || 0);
    broadcastPreview.count = Number.isFinite(nextCount) ? nextCount : 0;
    broadcastPreview.sample = Array.isArray(data?.sample) ? data.sample : [];
    previewUpdatedAt.value = isoStampNow();
    previewError.value = '';
  } catch (err) {
    console.error(err);
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    previewError.value = `Preview failed: ${msg}`;
  } finally {
    previewLoading.value = false;
  }
}

function scheduleBroadcastPreview() {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (!password.value) return;
  previewTimer = window.setTimeout(() => {
    refreshBroadcastPreview({ silent: true });
    previewTimer = null;
  }, 320);
}

async function sendBroadcast() {
  if (!canSendBroadcast.value) return;

  sendingBroadcast.value = true;
  sendError.value = '';
  sendInfo.value = '';

  try {
    const headers = adminHeaders();
    const payloadBody = {
      filters: broadcastFiltersPayload(),
      messageText: broadcast.messageText.trim()
    };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/send', {
      method: 'POST',
      headers,
      body: payloadBody
    });

    const campaignId = Number(data?.campaign_id || 0);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error('bad_campaign_id');
    }

    sendInfo.value = `Queued campaign #${campaignId} for ${fmt(data?.total_recipients || 0)} users.`;
    broadcastConfirm.value = '';
    await loadCampaignStatus(campaignId);
    startCampaignPolling(campaignId);
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    sendError.value = `Send failed: ${msg}`;
  } finally {
    sendingBroadcast.value = false;
  }
}

async function refreshAnalytics() {
  if (!canFetch.value) return;
  loading.value = true;
  errorText.value = '';
  try {
    const q = query();
    const headers = adminHeaders();
    const [
      summary,
      botStatsData,
      newUsers,
      newPaid,
      actionEvents,
      actionTotals,
      activeUsers,
      activeUsersByBot,
      inactiveUsers,
      usageSeconds,
      byHour,
      byHourToday,
      payloads
    ] = await Promise.all([
      apiJson(props.apiBase, '/admin/metrics/summary', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/bot-stats', { headers }),
      apiJson(props.apiBase, '/admin/metrics/new-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-paid-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/actions-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/action-totals', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day-by-bot', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/inactive-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/usage-seconds-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour-today', { query: { payload: q.payload }, headers }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    totals.value = summary?.totals || totals.value;
    botStats.value = Array.isArray(botStatsData?.bots) ? botStatsData.bots : [];
    newUsersSeries.value = Array.isArray(newUsers?.series) ? newUsers.series : [];
    newPaidSeries.value = Array.isArray(newPaid?.series) ? newPaid.series : [];
    actionEventsSeries.value = Array.isArray(actionEvents?.series) ? actionEvents.series : [];
    actionTotalsSeries.value = Array.isArray(actionTotals?.series)
      ? actionTotals.series.map((row) => ({
          day: actionLabel(row?.action),
          count: Number(row?.count || 0)
        }))
      : [];
    activeUsersSeries.value = Array.isArray(activeUsers?.series) ? activeUsers.series : [];
    inactiveUsersSeries.value = Array.isArray(inactiveUsers?.series) ? inactiveUsers.series : [];
    usageSecondsSeries.value = Array.isArray(usageSeconds?.series) ? usageSeconds.series : [];
    activeUsersByHourSeries.value = Array.isArray(byHour?.series) ? byHour.series : [];
    activeUsersByHourTodaySeries.value = Array.isArray(byHourToday?.series) ? byHourToday.series : [];
    payloadOptions.value = Array.isArray(payloads?.payloads) ? payloads.payloads : [];
    // Users list is loaded in the Users tab (separate request).
    
    // Transform bot-specific data
    const byBotRawRows = Array.isArray(activeUsersByBot?.series) ? activeUsersByBot.series : [];
    const { chartData: byBotData, seriesConfig: byBotConfig } = transformByBotData(byBotRawRows);
    activeUsersByBotSeries.value = byBotData;
    activeUsersByBotSeriesConfig.value = byBotConfig;
    
    lastUpdated.value = isoStampNow();
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    errorText.value = `Failed to load: ${msg}`;
  } finally {
    loading.value = false;
  }
}

async function refreshUsersPage({ resetOffset = false } = {}) {
  if (!canFetch.value) return;
  if (resetOffset) usersOffset.value = 0;
  usersLoading.value = true;
  usersError.value = '';
  try {
    const headers = adminHeaders();
    const q = query();
    const [usersRes, payloadsRes] = await Promise.allSettled([
      apiJson(props.apiBase, '/admin/users', {
        query: {
          ...q,
          limit: usersLimit.value,
          offset: usersOffset.value,
          sort_key: usersSort.key,
          sort_dir: usersSort.dir
        },
        headers
      }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    if (usersRes.status !== 'fulfilled') throw usersRes.reason;
    const data = usersRes.value;
    usersRows.value = Array.isArray(data?.items) ? data.items : [];
    usersTotal.value = Number.isFinite(Number(data?.total)) ? Number(data.total) : 0;

    if (payloadsRes.status === 'fulfilled') {
      payloadOptions.value = Array.isArray(payloadsRes.value?.payloads) ? payloadsRes.value.payloads : payloadOptions.value;
    }
  } catch (err) {
    console.error(err);
    usersRows.value = [];
    usersTotal.value = 0;
    const msg = err?.payload?.error || err?.message || 'request_failed';
    usersError.value = `Failed to load users: ${msg}`;
  } finally {
    usersLoading.value = false;
  }
}

async function refreshFeedback({ resetOffset = false } = {}) {
  if (resetOffset) feedbackOffset.value = 0;
  if (!canFetchFeedback.value) return;

  feedbackLoading.value = true;
  feedbackError.value = '';
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/feedbacks', {
      query: feedbackQuery(),
      headers
    });
    feedbackRows.value = Array.isArray(data?.items) ? data.items : [];
    const nextTotal = Number(data?.total || 0);
    feedbackTotal.value = Number.isFinite(nextTotal) ? nextTotal : 0;
    feedbackUpdatedAt.value = isoStampNow();
  } catch (err) {
    console.error(err);
    feedbackRows.value = [];
    feedbackTotal.value = 0;
    feedbackUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    feedbackError.value = `Failed to load feedback: ${msg}`;
  } finally {
    feedbackLoading.value = false;
  }
}

function feedbackNextPage() {
  if (!feedbackHasNext.value || feedbackLoading.value) return;
  feedbackOffset.value += feedbackLimit;
  refreshFeedback();
}

function feedbackPrevPage() {
  if (feedbackLoading.value) return;
  feedbackOffset.value = Math.max(0, feedbackOffset.value - feedbackLimit);
  refreshFeedback();
}

function resetRange() {
  rangePreset.value = 'last_30_days';
  const r = rangeForPreset('last_30_days');
  fromDate.value = r.from;
  toDate.value = r.to;
}

function applyRangePreset(preset) {
  rangePreset.value = preset;
  const r = rangeForPreset(preset);
  fromDate.value = r.from;
  toDate.value = r.to;
}

function resetFeedbackRange() {
  const r = defaultRange();
  feedbackFromDate.value = r.from;
  feedbackToDate.value = r.to;
}

function clearPassword() {
  password.value = '';
  errorText.value = '';
  previewError.value = '';
  sendError.value = '';
  sendInfo.value = '';
  broadcastPreview.count = 0;
  broadcastPreview.sample = [];
  previewUpdatedAt.value = '';
  campaignState.value = null;
  stopCampaignPolling();
  feedbackRows.value = [];
  feedbackTotal.value = 0;
  feedbackOffset.value = 0;
  feedbackError.value = '';
  feedbackUpdatedAt.value = '';
  usersRows.value = [];
  usersTotal.value = 0;
  usersOffset.value = 0;
  usersError.value = '';
}

function usersNextPage() {
  if (!usersHasNext.value || usersLoading.value) return;
  usersOffset.value += usersLimit.value;
  refreshUsersPage();
}

function usersPrevPage() {
  if (usersLoading.value) return;
  usersOffset.value = Math.max(0, usersOffset.value - usersLimit.value);
  refreshUsersPage();
}

onMounted(() => {
  try {
    const saved = (window.localStorage.getItem('admin_dashboard_tab') || '').toString();
    if (saved && ADMIN_TABS.includes(saved)) {
      activeTab.value = saved;
    }
  } catch {
    // ignore
  }
});

watch(
  () => [
    password.value,
    broadcast.username,
    broadcast.planFree,
    broadcast.planPro,
    broadcast.lastActivityMode,
    broadcast.lastActivityDays,
    broadcast.usageMode,
    broadcast.usagePercent,
    broadcast.botKeys.slice().sort().join(',')
  ],
  () => {
    if (!password.value) {
      previewError.value = '';
      broadcastPreview.count = 0;
      broadcastPreview.sample = [];
      previewUpdatedAt.value = '';
      return;
    }
    scheduleBroadcastPreview();
  },
  { deep: true }
);

watch(
  () => activeTab.value,
  (tab) => {
    try {
      window.localStorage.setItem('admin_dashboard_tab', tab);
    } catch {
      // ignore
    }

    if (tab === 'feedback' && password.value && feedbackRows.value.length === 0) {
      feedbackOffset.value = 0;
      refreshFeedback();
    }
    if (tab === 'users' && password.value && usersRows.value.length === 0) {
      refreshUsersPage({ resetOffset: true });
    }
  }
);

watch(
  () => botStats.value.map((bot) => bot.bot_key).join(','),
  () => {
    if (broadcast.botKeys.length === 0) return;
    const allowed = new Set(botStats.value.map((bot) => bot.bot_key));
    const next = broadcast.botKeys.filter((botKey) => allowed.has(botKey));
    if (next.length !== broadcast.botKeys.length) {
      broadcast.botKeys = next;
    }
  }
);

onBeforeUnmount(() => {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  stopCampaignPolling();
});
</script>

<style scoped>
.shell {
  width: min(1420px, 100%);
  padding: 44px 22px 76px;
  display: grid;
  gap: 18px;
  position: relative;
  isolation: isolate;
}

.shell::before {
  content: '';
  position: absolute;
  inset: -160px -80px -120px;
  z-index: -1;
  background:
    radial-gradient(420px 280px at 18% 6%, rgba(59, 130, 246, 0.18), transparent 60%),
    radial-gradient(420px 320px at 85% 22%, rgba(245, 158, 11, 0.14), transparent 62%),
    radial-gradient(520px 360px at 30% 82%, rgba(31, 107, 99, 0.14), transparent 65%),
    linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(248, 250, 252, 0.72));
}

.hero {
  display: grid;
  gap: 10px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

h1 {
  font-family: var(--font-display);
  margin: 0;
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: -0.02em;
  line-height: 1;
}

.sub {
  margin: 0;
  max-width: 70ch;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.landing-hero {
  border-radius: 26px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.46));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 26px 70px rgba(20, 18, 16, 0.16);
  padding: 18px;
  overflow: hidden;
  position: relative;
}

.landing-hero::before {
  content: '';
  position: absolute;
  inset: -120px -120px auto;
  height: 260px;
  background:
    radial-gradient(240px 160px at 30% 55%, rgba(59, 130, 246, 0.20), transparent 70%),
    radial-gradient(260px 180px at 70% 40%, rgba(245, 158, 11, 0.16), transparent 72%);
  pointer-events: none;
}

.landing-hero-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1.2fr 0.9fr;
  gap: 14px;
  align-items: stretch;
}

.landing-copy {
  display: grid;
  gap: 12px;
  align-content: start;
  padding: 8px 8px 8px 6px;
}

.landing-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(246, 241, 232, 0.55);
  color: rgba(30, 26, 22, 0.78);
  font-size: 12px;
  font-weight: 650;
}

.landing-pill-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.95);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
}

.landing-pill-sep {
  opacity: 0.55;
}

.landing-title {
  margin: 0;
  font-size: clamp(22px, 2.6vw, 36px);
  line-height: 1.08;
  letter-spacing: -0.02em;
}

.landing-sub {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
  max-width: 70ch;
}

.landing-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.trust {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.trust-label {
  font-size: 12px;
  color: var(--muted);
}

.trust-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.64);
  color: rgba(30, 26, 22, 0.78);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.trust-ic {
  width: 16px;
  height: 16px;
}

.landing-viz {
  display: grid;
  align-content: start;
}

.viz-card {
  border-radius: 22px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(246, 241, 232, 0.42);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 14px;
  display: grid;
  gap: 12px;
  box-shadow: 0 20px 60px rgba(20, 18, 16, 0.14);
}

.viz-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.viz-kicker {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 10px;
  color: rgba(30, 26, 22, 0.55);
}

.viz-title {
  font-weight: 760;
  letter-spacing: -0.01em;
}

.viz-meta {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.viz-badge {
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.62);
  color: rgba(30, 26, 22, 0.72);
  font-size: 11px;
  padding: 4px 8px;
  font-weight: 750;
}

.viz-badge.live {
  border-color: rgba(31, 107, 99, 0.28);
  background: rgba(31, 107, 99, 0.10);
  color: rgba(31, 107, 99, 0.92);
}

.viz-stamp {
  color: rgba(30, 26, 22, 0.55);
  font-size: 11px;
  white-space: nowrap;
}

.spark {
  border-radius: 16px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(255, 255, 255, 0.62);
  overflow: hidden;
  padding: 10px 12px 8px;
}

.spark svg {
  width: 100%;
  height: auto;
  display: block;
}

.spark-axis {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(30, 26, 22, 0.55);
}

.spark-note {
  color: rgba(245, 158, 11, 0.92);
  font-weight: 750;
}

.viz-foot {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.viz-metric {
  border-radius: 16px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(255, 255, 255, 0.52);
  padding: 10px 10px 9px;
  display: grid;
  gap: 4px;
}

.viz-metric-label {
  font-size: 11px;
  color: rgba(30, 26, 22, 0.55);
}

.viz-metric-value {
  font-family: var(--font-display);
  font-weight: 750;
  letter-spacing: -0.02em;
  font-size: 18px;
}

.viz-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(30, 26, 22, 0.60);
}

.landing-section {
  border-radius: 22px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 20px 60px rgba(20, 18, 16, 0.12);
  padding: 16px 16px 14px;
  display: grid;
  gap: 12px;
}

.landing-section-head {
  display: grid;
  gap: 6px;
}

.landing-section-head h3 {
  margin: 0;
  font-size: 18px;
  letter-spacing: -0.01em;
}

.landing-section-head p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.feature {
  border-radius: 18px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(246, 241, 232, 0.36);
  padding: 12px;
  display: grid;
  gap: 8px;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.feature:hover {
  border-color: rgba(59, 130, 246, 0.26);
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 18px 44px rgba(20, 18, 16, 0.12);
}

.feature-ic {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.62);
  display: grid;
  place-items: center;
  color: rgba(30, 64, 175, 0.9);
}

.feature-ic :deep(svg.ic) {
  width: 22px;
  height: 22px;
}

.feature-title {
  font-weight: 760;
  letter-spacing: -0.01em;
}

.feature-desc {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.pricing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.pricing {
  border-radius: 18px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(246, 241, 232, 0.32);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.pricing.featured {
  border-color: rgba(245, 158, 11, 0.32);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.66), rgba(246, 241, 232, 0.36));
}

.pricing-tier {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.pricing-badge {
  border-radius: 999px;
  padding: 4px 8px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.12);
  color: rgba(199, 90, 36, 0.95);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.pricing-price {
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.pricing-sub {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.pricing-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 7px;
  color: rgba(30, 26, 22, 0.78);
  font-size: 12px;
}

.pricing-list li {
  display: flex;
  gap: 8px;
  align-items: center;
}

.pricing-list li::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.85);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.landing-note {
  margin: 0;
  color: rgba(30, 26, 22, 0.55);
  font-size: 12px;
}

@media (max-width: 980px) {
  .landing-hero-grid {
    grid-template-columns: 1fr;
  }
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 540px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .pricing-grid {
    grid-template-columns: 1fr;
  }
  .viz-foot {
    grid-template-columns: 1fr;
  }
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tab-btn {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.tab-btn.active {
  background: rgba(31, 107, 99, 0.16);
  border-color: rgba(31, 107, 99, 0.28);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 210px;
}

.field span {
  font-size: 12px;
  color: var(--muted);
}

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select,
.field textarea {
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.16);
  background: rgba(246, 241, 232, 0.6);
  padding: 0 12px;
  font: inherit;
  color: var(--ink);
  outline: none;
}

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select {
  height: 42px;
}

.field textarea {
  min-height: 120px;
  padding: 10px 12px;
  resize: vertical;
}

.field select {
  appearance: none;
}

.field input[type='text']:focus,
.field input[type='password']:focus,
.field input[type='date']:focus,
.field input[type='number']:focus,
.field select:focus,
.field textarea:focus {
  border-color: rgba(31, 107, 99, 0.55);
  box-shadow: 0 0 0 4px rgba(31, 107, 99, 0.15);
}

.grow {
  flex: 1;
  min-width: 280px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.btn {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 26px rgba(30, 26, 22, 0.14);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.btn:active {
  transform: translateY(1px);
  box-shadow: 0 9px 18px rgba(30, 26, 22, 0.12);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.primary {
  background: rgba(199, 90, 36, 0.16);
  border-color: rgba(199, 90, 36, 0.28);
}

.danger {
  background: rgba(174, 43, 40, 0.12);
  border-color: rgba(174, 43, 40, 0.22);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.hint code {
  font-size: 12px;
}

.error {
  margin: 0;
  color: rgba(174, 43, 40, 0.9);
  font-size: 13px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.broadcast {
  display: grid;
  gap: 14px;
}

.feedback {
  display: grid;
  gap: 14px;
}

.feedback-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.feedback h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.feedback-count {
  border: 1px solid rgba(31, 107, 99, 0.2);
  background: rgba(31, 107, 99, 0.08);
  border-radius: 16px;
  padding: 8px 12px;
  font-weight: 650;
}

.broadcast h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.broadcast-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.compact {
  margin-top: 6px;
}

.broadcast-counter {
  min-width: 180px;
  border: 1px solid rgba(31, 107, 99, 0.2);
  background: rgba(31, 107, 99, 0.08);
  border-radius: 16px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.counter-label {
  font-size: 12px;
  color: var(--muted);
}

.counter-value {
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1;
}

.counter-meta {
  font-size: 11px;
  color: var(--muted);
}

.plan-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 42px;
  align-items: center;
}

.pill {
  border: 1px solid rgba(30, 26, 22, 0.14);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.62);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.pill:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(31, 107, 99, 0.3);
}

.pill.active {
  background: rgba(31, 107, 99, 0.12);
  border-color: rgba(31, 107, 99, 0.4);
  font-weight: 600;
}

.pill input {
  height: 14px;
  width: 14px;
  margin: 0;
  cursor: pointer;
}

.preview-sample {
  border-top: 1px solid rgba(30, 26, 22, 0.1);
  padding-top: 10px;
  display: grid;
  gap: 6px;
}

.sample-title {
  font-size: 12px;
  color: var(--muted);
}

.preview-sample ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.preview-sample li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.bot-badge {
  background: rgba(99, 102, 241, 0.1);
  color: rgb(99, 102, 241);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', monospace;
}

.campaign-state {
  border-top: 1px solid rgba(30, 26, 22, 0.1);
  padding-top: 10px;
  display: grid;
  gap: 6px;
}

.campaign-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chip {
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.14);
  padding: 2px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(246, 241, 232, 0.55);
}

.campaign-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.feedback-list {
  display: grid;
  gap: 10px;
}

.feedback-item {
  border: 1px solid rgba(30, 26, 22, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.64);
  padding: 10px 12px;
  display: grid;
  gap: 8px;
}

.feedback-item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.feedback-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.feedback-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  color: var(--ink);
}

.feedback-pager {
  display: flex;
  gap: 10px;
}

.users-table-card {
  gap: 10px;
}

.users-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}

.users-head h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.users-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
  flex-wrap: wrap;
}

.users-limit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.users-limit select {
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 255, 255, 0.65);
  border-radius: 10px;
  padding: 4px 8px;
  font: inherit;
  color: var(--ink);
}

.users-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(30, 26, 22, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.64);
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.users-table th,
.users-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(30, 26, 22, 0.08);
  text-align: left;
  white-space: nowrap;
}

.users-table th {
  color: var(--muted);
  font-weight: 650;
  background: rgba(246, 241, 232, 0.6);
}

.users-table tbody tr:last-child td {
  border-bottom: none;
}

@media (max-width: 820px) {
  .cards {
    grid-template-columns: 1fr;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .broadcast-head {
    flex-direction: column;
  }

  .broadcast-counter {
    width: 100%;
  }
}

.stat {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px 14px 12px;
  display: grid;
  gap: 6px;
}

.label {
  color: var(--muted);
  font-size: 12px;
}

.value {
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.value-pair {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.value-secondary {
  font-size: 19px;
  color: var(--muted);
}

.meta {
  color: var(--muted);
  font-size: 12px;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 8px;
}

.link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: var(--accent-2);
  font-weight: 650;
}

.stamp {
  opacity: 0.9;
}

.bot-stats-head {
  display: grid;
  gap: 6px;
}

.bot-table-wrap {
  margin-top: 10px;
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.35);
}

.bot-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}

.bot-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(246, 241, 232, 0.9);
  border-bottom: 1px solid rgba(30, 26, 22, 0.10);
  padding: 10px 10px;
  text-align: left;
  font-size: 12px;
  color: rgba(30, 26, 22, 0.78);
  white-space: nowrap;
}

.bot-table th.num,
.bot-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.bot-table tbody td {
  border-top: 1px solid rgba(30, 26, 22, 0.08);
  padding: 10px 10px;
  font-size: 13px;
  color: rgba(30, 26, 22, 0.85);
  white-space: nowrap;
}

.bot-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.55);
}

.sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: inherit;
  font-weight: 700;
}

.sort-ind {
  display: inline-block;
  min-width: 10px;
  opacity: 0.65;
}

.bot {
  display: grid;
  gap: 2px;
}

.bot-key {
  font-family: var(--font-display);
  font-weight: 760;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.bot-meta {
  font-size: 12px;
  color: var(--muted);
}
</style>

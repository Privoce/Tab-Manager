import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { observer } from 'mobx-react';
import { Col, Row } from 'antd';
import socketIOClient from 'socket.io-client';
import ReactGA from 'react-ga';

import { Launcher } from './launcher/launcher';
import { Workspace } from './workspace/workspace';
import { Notes } from './notes/note';

import 'antd/dist/antd.less';
import '../css/portal.less';
import gpsIcon from '../assets/gps-icon.png';
import sunIcon from '../assets/sun-icon.png';
import { Calendar } from './calendar/calendar';

import { BACKEND_URL, OPEN_WEATHER_API_KEY } from './misc/variables';

import { withTranslation } from 'react-i18next';
import '../locales/i18n';
import { format } from 'date-fns';

ReactGA.initialize('UA-110173205-3');
ReactGA.set({ checkProtocolTask: null });
ReactGA.pageview(window.location.pathname + window.location.search);

@observer
class Portal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      historyDomains: [],
      workspaces: [],
      currentWorkspaceId: null,
      user: {
        name: '',
        googleConnect: false,
        token: '',
        events: [],
      },
      location: {
        city: '',
        region: '',
        temp: '',
      },
      hour: '',
      eventLoading: true,
    };

    this.socket = null;
    this.timer = null;
    this.loginHandle = this.loginHandle.bind(this);
    this.getEventsFromServer = this.getEventsFromServer.bind(this);
  }

  getHour = () => {
    const date = new Date();
    const hour = date.getHours();
    const minutes = date.getMinutes();

    this.setState({
      hour: `${hour < 10 ? '0' : ''}${hour}:${
        minutes < 10 ? '0' : ''
      }${minutes}`,
    });
  };

  async getEventsFromServer(date = new Date()) {
    const { user } = this.state;

    // if dont have google account connected
    if (!user.googleConnect || user.token == '') {
      return;
    }

    this.setState({
      eventLoading: true,
    });

    const response = await fetch(
      `${BACKEND_URL}user/calendar?date=${format(date, 'MM-dd-yyyy')}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': user.token,
        },
      },
    );

    this.setState({
      eventLoading: false,
    });

    if (response.status > 204) {
      // return alert('Session expired!');
    }

    const data = await response.json();

    if (data.events && data.events.length > 0) {
      const events = data.events.map(event => ({
        id: event.id,
        start: event.start.date
          ? new Date(`${event.start.date} 00:00`)
          : new Date(event.start.dateTime),
        end: event.end.date
          ? new Date(`${event.end.date} 00:00`)
          : new Date(event.end.dateTime),
        title: event.summary,
        allDay: event.start.date ? true : false,
      }));

      // If is the same events, dont update the state
      if (JSON.stringify(this.state.events) === JSON.stringify(events)) {
        return;
      }

      this.setState({
        user: {
          ...this.state.user,
          events,
        },
      });
      // If return no events, i clean on state too
    } else {
      this.setState({
        user: {
          ...this.state.user,
          events: [],
        },
      });
    }
  }

  async getLocationAndWeather() {
    const locationResponse = await fetch('http://ip-api.com/json/', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const locationData = await locationResponse.json();

    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${locationData.city},${locationData.region},br&appid=${OPEN_WEATHER_API_KEY}`;

    const weatherResponse = await fetch(weatherUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const weatherData = await weatherResponse.json();

    this.setState({
      location: {
        city: locationData.city,
        region: locationData.region,
        temp: Math.floor(Number(weatherData.main.temp) - 273.15),
      },
    });
  }

  loginHandle = () => {
    const globalThis = this;

    chrome.tabs.create({
      url: `${BACKEND_URL}auth/google?redirect=https://privoce.com/thankyou.html?token=`,
    });

    // we can improve this, listering only the auth tab
    chrome.tabs.onUpdated.addListener(async function authorizationHook(
      tabId,
      changeInfo,
      tab,
    ) {
      //If you don't have the authentication tab id remove that part
      if (tab.title.indexOf('token=') >= 0) {
        //tab url consists of access_token
        var url = new URL(tab.url);
        const urlParams = new URLSearchParams(url.search);
        const token = urlParams.get('token');

        if (!token) {
          alert('Error');
          return;
        }

        const userResponse = await fetch(`${BACKEND_URL}auth/me`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': token,
          },
        });

        if (userResponse.status !== 200) {
          return alert('User not found');
        }

        const userData = await userResponse.json();

        globalThis.setState({
          user: {
            name: userData.user.nickname,
            googleConnect: true,
            token,
            events: [],
          },
        });

        //save on localstorage
        localStorage.setItem('nickname', userData.user.nickname);
        localStorage.setItem('googleConnect', 'true');
        localStorage.setItem('token', token);
        localStorage.setItem('userId', userData.user._id);

        globalThis.socket.emit('storeClientInfo', userData.user);
        globalThis.getEventsFromServer();

        setTimeout(() => {
          chrome.tabs.remove(tabId);
          chrome.tabs.onUpdated.removeListener(authorizationHook);
          chrome.tabs.highlight({
            tabs: [0],
          });
        }, 1000);
      }
    });
  };

  onLauncherInteract = () => {
    ReactGA.event({
      category: 'Widget Interaction',
      action: 'Launcher',
    });
  };

  onCalendarInteract = () => {
    ReactGA.event({
      category: 'Widget Interaction',
      action: 'Calendar',
    });
  };

  onNoteInteract = () => {
    ReactGA.event({
      category: 'Widget Interaction',
      action: 'Note',
    });
  };

  onWorkspaceInteract = () => {
    ReactGA.event({
      category: 'Widget Interaction',
      action: 'Workspace',
    });
  };

  componentDidMount() {
    ReactGA.pageview('/portal.html');

    this.socket = socketIOClient(BACKEND_URL);

    const googleConected = localStorage.getItem('googleConnect');
    const nickname = localStorage.getItem('nickname');
    const userId = localStorage.getItem('userId');
    const token = localStorage.getItem('token');

    if (googleConected === 'true') {
      this.socket.emit('storeClientInfo', { nickname, _id: userId });
    }

    this.socket.on('new-event', data => {
      this.getEventsFromServer();
    });

    this.setState(
      {
        user: {
          ...this.state.user,
          name: nickname,
          token,
          googleConnect: googleConected === 'true',
        },
      },
      () => this.getEventsFromServer(),
    );

    this.getLocationAndWeather();

    // update clock every minute
    this.getHour();
    setInterval(() => {
      this.getLocationAndWeather();
      this.getHour();
    }, 40000);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  render() {
    const { location, user, hour, eventLoading } = this.state;
    const { t } = this.props;
    return (
      <Row className="container--portal">
        <Col span={6}>
          <h1 className="home--clock">{hour}</h1>
          <h1 className="home--username">
            {t('WELCOME')}
            {user.name
              ? `${user.name.charAt(0).toUpperCase()}${user.name.slice(1)}`
              : ''}
          </h1>
          <p className="home--weather">
            <img src={sunIcon} width={20} height={20} /> {location.temp}° C
          </p>
          <p className="home--location">
            <img src={gpsIcon} width={17} height={17} /> {location.city},{' '}
            {location.region}
          </p>
          <div
            className="home--history"
            onClick={this.onLauncherInteract}
            onContextMenu={this.onLauncherInteract}
          >
            <Launcher translation={t} />
          </div>
        </Col>

        <Col span={9}>
          {
            // We should replace them with antd's Card Componment
          }
          {/*<div className="home--calendar-toolbar calendar-header">*/}
          {/*  <img src={calendarImg} alt="" />*/}
          {/*  <h2 className="home--calendar">Calendar</h2>*/}
          {/*</div>*/}
          <div className="site-calendar-demo-card">
            <div
              className="calendar"
              onClick={this.onCalendarInteract}
              onContextMenu={this.onCalendarInteract}
            >
              <Calendar
                onLogin={this.loginHandle}
                user={user}
                eventLoading={eventLoading}
                getEvents={this.getEventsFromServer}
              />
            </div>
          </div>

          <div className="note-container">
            {/*<div className="home--calendar-toolbar calendar-header">*/}
            {/*  <img src={noteIcon} alt="" />*/}
            {/*  <h2 className="home--calendar">Notes</h2>*/}
            {/*</div>*/}
            <div className="site-calendar-demo-card">
              <div
                className="notes"
                onClick={this.onNoteInteract}
                onContextMenu={this.onNoteInteract}
              >
                <Notes translate={t} />
              </div>
            </div>
          </div>
        </Col>

        <Col span={9}>
          {/*<div className="home--workspace-toolbar workspace-header">*/}
          {/*  <img src={workspaceImg} alt="" />*/}
          {/*  <h2 className="home--workspace">Workspace</h2>*/}
          {/*</div>*/}
          <div
            className="workspace"
            onClick={this.onWorkspaceInteract}
            onContextMenu={this.onWorkspaceInteract}
          >
            <Workspace />
          </div>
        </Col>
      </Row>
    );
  }
}

const MyComponent = withTranslation()(Portal);

export default function App() {
  return (
    <Suspense fallback="loading">
      <MyComponent />
    </Suspense>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));

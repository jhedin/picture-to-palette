import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Redirect, Route } from "react-router-dom";
import Capture from "./pages/Capture";
import Palette from "./pages/Palette";
import Gradients from "./pages/Gradients";
import { PaletteProvider } from "./lib/palette-store";

export default function App() {
  return (
    <IonApp>
      <PaletteProvider>
        <IonReactRouter basename="/picture-to-palette">
          <IonRouterOutlet>
            <Route exact path="/capture" component={Capture} />
            <Route exact path="/palette" component={Palette} />
            <Route exact path="/gradients" component={Gradients} />
            <Route exact path="/">
              <Redirect to="/capture" />
            </Route>
          </IonRouterOutlet>
        </IonReactRouter>
      </PaletteProvider>
    </IonApp>
  );
}

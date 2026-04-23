import {
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";

export default function Home() {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Picture to Palette</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <h2>Scaffold is live.</h2>
          <p>
            The palette extraction UI hasn't been designed yet — the next session
            will brainstorm the screens, write a spec, and build via TDD.
          </p>
        </IonText>
      </IonContent>
    </IonPage>
  );
}
